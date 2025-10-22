import {
	PageSnapshot,
	TabSnapshot,
	WindowSnapshot,
	WorkspaceCapture,
	GoogleDocsData,
	GoogleSheetsData,
	GoogleSlidesData,
	GoogleFormsData,
	GmailData,
	ArticleData,
	SearchData,
	SearchResultData,
	PageType,
	ChromeMessage,
	AIInsight,
} from "./types.js";
import AWSAPIService from "./awsService.js";

interface ExpirationConfig {
	retentionMs: number;
	cleanupIntervalMinutes: number;
}

// Using a local variable and Chrome state management instead of more modern ways of state management here for the sake of keeping the bundle size and complexity minimal for a hackathon MVP
// TODO If time allows, investigate and improve state management
let isCapturing = false;

// Idle detection logic
chrome.idle.onStateChanged.addListener(async (newState) => {
	const timestamp = new Date().toISOString();
	const settings = await chrome.storage.sync.get({ isActive: true, idleTime: 15 });

	console.log(
		`[NORO] ${timestamp} - Idle state changed to: ${newState} (isActive: ${settings.isActive}, isCapturing: ${isCapturing}, idleThreshold: ${settings.idleTime}s)`
	);

	if (newState === "idle" && !isCapturing && settings.isActive) {
		console.log(`[NORO] ${timestamp} - USER WENT IDLE! Starting workspace capture and analysis flow...`);
		console.log(`[NORO] ${timestamp} - Step 1/8: Updating icon to tracking state`);
		await updateExtensionBadge("tracking");
		await sendCaptureStatus("capturing");
		console.log(`[NORO] ${timestamp} - Step 2/8: Beginning workspace capture`);
		await captureWorkspace();
	} else if (newState === "active") {
		console.log(`[NORO] ${timestamp} - User returned to active state`);
		if (settings.isActive) {
			console.log(`[NORO] ${timestamp} - Returning to idle icon state`);
			await updateExtensionBadge("idle");
			await sendCaptureStatus(null);
		}
	} else if (!settings.isActive) {
		console.log(`[NORO] ${timestamp} - Capture is paused - skipping idle capture`);
		await updateExtensionBadge("offline");
		await sendCaptureStatus("paused");
	}
});

chrome.runtime.onMessage.addListener(async (message: ChromeMessage, sender, sendResponse) => {
	console.log(`[NORO] ${new Date().toISOString()} - 📨 Received message:`, message.action);

	switch (message.action) {
		case "toggleCapture":
			isCapturing = false;
			await chrome.storage.sync.set({ isActive: message.isActive });
			console.log("[NORO] Capture", message.isActive ? "resumed" : "paused");
			// Update icon based on new state
			await updateExtensionBadge(message.isActive ? "idle" : "offline");
			await sendCaptureStatus(message.isActive ? null : "paused");
			break;
		case "updateIdleTime":
			chrome.idle.setDetectionInterval(message.idleTime || 15);
			console.log("[NORO] Idle time:", message.idleTime, "seconds");
			break;
		case "manualCapture":
			console.log("[NORO] Manual capture requested");
			if (!isCapturing) {
				await captureWorkspace();
			} else {
				console.log("[NORO] Capture already in progress");
			}
			break;
	}
}); // Removed duplicate idle listener - functionality already handled above

const DEFAULT_EXPIRATION: ExpirationConfig = {
	retentionMs: 7 * 24 * 60 * 60 * 1000,
	cleanupIntervalMinutes: 1440,
};

cleanupExpiredSnapshots();

async function initializeExtension() {
	try {
		// Initialize default settings if they don't exist
		const currentSettings = await chrome.storage.sync.get({
			isActive: true,
			idleTime: 15,
			retentionDays: 7,
			userId: null,
		});

		// Generate userId if it doesn't exist
		if (!currentSettings.userId) {
			currentSettings.userId = "user_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
		}

		// Save all settings
		await chrome.storage.sync.set(currentSettings);

		// Set initial idle detection interval
		chrome.idle.setDetectionInterval(currentSettings.idleTime);

		// Set initial icon state based on isActive setting
		await updateExtensionBadge(currentSettings.isActive ? "idle" : "offline");

		console.log("[NORO] Extension initialized:", {
			userId: currentSettings.userId.slice(0, 8) + "...",
			isActive: currentSettings.isActive,
			idleTime: currentSettings.idleTime,
		});

		// Test idle detection
		chrome.idle.queryState(currentSettings.idleTime, (state) => {
			console.log("[NORO] Current idle state:", state);
		});

		// Retry failed AWS submissions
		const awsService = AWSAPIService.getInstance();
		awsService.retryFailedSubmissions().catch((error: any) => {
			console.error("[NORO] Failed to retry AWS submissions:", error);
		});
	} catch (error) {
		console.error("[NORO] Initialization failed:", error);
		// Set offline icon if initialization fails
		await updateExtensionBadge("offline");
	}
}

// Initialize extension on startup/install
chrome.runtime.onStartup.addListener(async () => {
	console.log("[NORO] Extension starting up");
	await initializeExtension();
});

chrome.runtime.onInstalled.addListener(async () => {
	console.log("[NORO] Extension installed/updated");
	await initializeExtension();
});

async function cleanupExpiredSnapshots() {
	try {
		const cutoff = Date.now() - DEFAULT_EXPIRATION.retentionMs;
		// There's no getAll function, so I improvised
		const allData = await chrome.storage.local.get(null);
		const toBeDeleted: string[] = [];

		for (const [key, value] of Object.entries(allData)) {
			if (key.startsWith("workspace_")) {
				const workspace = value as WorkspaceCapture;
				if (workspace.timestamp < cutoff) {
					toBeDeleted.push(key);
					workspace.windows.forEach((window) =>
						window.tabs.forEach(
							(tab) => tab.snapshot.data?.screenshot && toBeDeleted.push(tab.snapshot.data.screenshot)
						)
					);
				} else if (key.startsWith("img_")) {
					const match = key.match(/img_(\d+)_/);
					if (match && parseInt(match[1]) < cutoff) toBeDeleted.push(key);
				}
			}
		}
		if (toBeDeleted.length) {
			await chrome.storage.local.remove(toBeDeleted);
			console.log("[NORO] Cleaned", toBeDeleted.length, "expired items");
		}
	} catch (e) {
		console.error("[NORO] Cleanup failed: ", e);
	}
}

async function captureWorkspace() {
	try {
		isCapturing = true;
		const captureStartTime = new Date().toISOString();
		console.log(`[NORO] ${captureStartTime} - 🚀 STARTING COMPREHENSIVE WORKSPACE CAPTURE...`);
		console.log(`[NORO] ${captureStartTime} - isCapturing flag set to: ${isCapturing}`);

		const windows = await chrome.windows.getAll({ populate: true });
		console.log(`[NORO] ${new Date().toISOString()} - Found ${windows.length} windows to process`);

		const workspace: WorkspaceCapture = {
			timestamp: Date.now(),
			windows: [],
		};

		for (const window of windows) {
			if (!window.tabs?.length) {
				console.log(`[NORO] ${new Date().toISOString()} - Window ${window.id} has no tabs, skipping`);
				continue;
			}
			console.log(
				`[NORO] ${new Date().toISOString()} - Processing window ${window.id} with ${window.tabs.length} tabs`
			);

			const windowSnapshot: WindowSnapshot = {
				windowId: window.id!,
				activeTabId: -1,
				tabs: [],
			};
			// TODO there may be a limitation to the properties we have access to when using window.tabs to get tab data. Find out if it affects extension functionality and fix.
			for (const tab of window.tabs) {
				console.log(
					`[NORO] ${new Date().toISOString()} - Processing tab ${tab.id}: "${tab.title}" - ${tab.url}`
				);
				if (!tab.id || !tab.url?.startsWith("http")) {
					console.log(
						`[NORO] ${new Date().toISOString()} - Skipping tab ${tab.id} - no ID or not HTTP: ${tab.url}`
					);
					continue;
				}

				try {
					console.log(`[NORO] ${new Date().toISOString()} - Executing content script on tab ${tab.id}`);
					// TODO Maybe the [] around result is not needed. Look into it.
					const [result] = await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						func: capturePageSnapshot,
					});

					if (result?.result) {
						console.log(
							`[NORO] ${new Date().toISOString()} - Successfully captured tab ${tab.id}: type "${
								result.result.type
							}", title "${result.result.title}"`
						);
						if (tab.active) {
							windowSnapshot.activeTabId = tab.id;
							console.log(
								`[NORO] ${new Date().toISOString()} - Marked tab ${tab.id} as active tab in window ${
									window.id
								}`
							);
						}
						const tabSnapshot: TabSnapshot = {
							tabId: tab.id,
							isActive: tab.active || false,
							snapshot: result.result,
						};
						windowSnapshot.tabs.push(tabSnapshot);
					} else {
						console.log(
							`[NORO] ${new Date().toISOString()} - No result from tab ${
								tab.id
							} - content script may have failed`
						);
					}
				} catch (e) {
					// TODO The logical conclusion for running into a tab we have failed to capture would be to skip it, but there may be potential for a retry loop to reduce the failure rate...
					console.error(`[NORO] ${new Date().toISOString()} - Failed to capture tab ${tab.id}:`, e);
				}
			}

			const activeTab = windowSnapshot.tabs.find((tab) => tab.isActive);
			if (activeTab?.snapshot.data?.screenshot === null) {
				console.log(
					`[NORO] ${new Date().toISOString()} - Capturing screenshot for active tab ${
						activeTab.tabId
					} in window ${window.id}`
				);
				try {
					const image = await chrome.tabs.captureVisibleTab(window.id!, { format: "jpeg", quality: 60 });
					if (image) {
						const filename = `img_${workspace.timestamp}_${activeTab.tabId}`;
						await chrome.storage.local.set({ [filename]: image });
						activeTab.snapshot.data.screenshot = filename;
						console.log(
							`[NORO] ${new Date().toISOString()} - Screenshot saved successfully: ${filename} (${Math.round(
								image.length / 1024
							)}KB)`
						);
					}
				} catch (e) {
					// TODO If the screenshotting process fails, do we skip or retry? Figure it out.
					console.error(
						`[NORO] ${new Date().toISOString()} - Screenshot failed for tab ${activeTab.tabId} in window ${
							window.id
						}:`,
						e
					);
				}
			} else if (activeTab?.snapshot.data) {
				console.log(
					`[NORO] ${new Date().toISOString()} - Active tab ${activeTab.tabId} in window ${
						window.id
					} does not require screenshot (page type: ${activeTab.snapshot.type})`
				);
			}

			if (windowSnapshot.tabs.length) {
				console.log(
					`[NORO] ${new Date().toISOString()} - Window ${window.id} snapshot complete with ${
						windowSnapshot.tabs.length
					} tabs, adding to workspace`
				);
				workspace.windows.push(windowSnapshot);
			} else {
				console.log(
					`[NORO] ${new Date().toISOString()} - Window ${window.id} snapshot has no valid tabs, skipping`
				);
			}
		}

		console.log(
			`[NORO] ${new Date().toISOString()} - 🔍 DEBUG: Finished processing all windows. Windows processed: ${
				workspace.windows.length
			}`
		);

		console.log(
			`[NORO] ${new Date().toISOString()} - 🔍 DEBUG: About to save workspace to storage and calculate totals`
		);

		const workspaceKey = `workspace_${workspace.timestamp}`;
		await chrome.storage.local.set({ [workspaceKey]: workspace });

		const totalTabs = workspace.windows.reduce((sum, w) => sum + w.tabs.length, 0);
		const captureEndTime = new Date().toISOString();
		console.log(
			`[NORO] ${captureEndTime} - Workspace capture complete: ${workspace.windows.length} windows with ${totalTabs} total tabs`
		);
		console.log(`[NORO] ${captureEndTime} - Workspace data stored with key: ${workspaceKey}`);

		// Log detailed capture summary
		workspace.windows.forEach((window, idx) => {
			console.log(
				`[NORO] ${captureEndTime} - Window ${idx + 1} (ID: ${window.windowId}): ${
					window.tabs.length
				} tabs, active tab: ${window.activeTabId}`
			);
			window.tabs.forEach((tab, tabIdx) => {
				const hasScreenshot = tab.snapshot.data?.screenshot ? " [SCREENSHOT]" : "";
				console.log(
					`[NORO] ${captureEndTime} -   Tab ${tabIdx + 1}: "${tab.snapshot.title}" (${
						tab.snapshot.type
					})${hasScreenshot}`
				);
			});
		});

		// Submit to AWS for AI analysis
		console.log(`[NORO] ${new Date().toISOString()} - 🔄 WORKSPACE CAPTURE COMPLETE - Starting AWS submission...`);
		console.log(
			`[NORO] ${new Date().toISOString()} - 🔍 DEBUG: About to call submitWorkspaceToAWS with ${totalTabs} tabs`
		);

		try {
			await submitWorkspaceToAWS(workspace);
			console.log(`[NORO] ${new Date().toISOString()} - ✅ AWS submission completed successfully`);
		} catch (error) {
			console.error(`[NORO] ${new Date().toISOString()} - ❌ AWS submission failed:`, error);
		}

		console.log(
			`[NORO] ${new Date().toISOString()} - ✅ captureWorkspace() function completed, isCapturing set to false`
		);
		isCapturing = false;
	} catch (error) {
		console.error(`[NORO] ${new Date().toISOString()} - 💥 CRITICAL ERROR in captureWorkspace():`, error);
		console.error(`[NORO] ${new Date().toISOString()} - Error stack:`, (error as Error)?.stack);
		isCapturing = false;
		throw error; // Re-throw to ensure calling code knows about the failure
	}
}

function capturePageSnapshot(): PageSnapshot {
	function detectPageType(): { type: PageSnapshot["type"] } {
		const url = window.location.href;
		// Google Workspace
		if (url.includes("docs.google.com/document")) return { type: "google-docs" };
		if (url.includes("docs.google.com/spreadsheets")) return { type: "google-sheets" };
		if (url.includes("docs.google.com/presentation")) return { type: "google-slides" };
		if (url.includes("docs.google.com/forms")) return { type: "google-forms" };
		if (url.includes("mail.google.com")) return { type: "gmail" };
		// Search engines
		const urlObj = new URL(url);
		if (urlObj.searchParams.has("q") || urlObj.searchParams.has("query") || urlObj.searchParams.has("search"))
			return { type: "search" };
		// Web articles
		if (document.querySelector("article")) return { type: "article" }; // TODO this approach may be too simple for article detection, find a better way to do this
		// General web browsing
		if (url.startsWith("http")) return { type: "general" };
		return { type: "unknown" };
	}

	function captureGoogleDocsData(): GoogleDocsData {
		const documentName = document.title.split(" - Google Docs")[0] || "Unknown Document";

		const googleDocsData: GoogleDocsData = {
			documentName,
			screenshot: null,
		};
		return googleDocsData;
	}

	function captureGoogleSheetsData(): GoogleSheetsData {
		const workbook = document.title.split(" - Google Sheets")[0] || "Unknown Workbook Name";
		const activeSheet =
			document.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name")?.textContent?.trim() ||
			"Unknown Sheet Name";
		const nameBox = document.querySelector("#t-name-box") as HTMLInputElement;
		const selectedRange = nameBox.value || "Unknown";

		const googleSheetsData: GoogleSheetsData = {
			workbook,
			activeSheet,
			selectedRange,
			screenshot: null,
		};
		return googleSheetsData;
	}

	function captureGoogleSlidesData(): GoogleSlidesData {
		const presentationName = document.title.split(" - Google Slides")[0] || "Unknown Presentation";

		const googleSlidesData: GoogleSlidesData = {
			presentationName,
			screenshot: null,
		};
		return googleSlidesData;
	}

	function captureGoogleFormsData(): GoogleFormsData {
		const formName = document.title.split(" - Google Forms")[0] || "Unknown Form";

		const googleFormsData: GoogleFormsData = {
			formName,
			screenshot: null,
		};
		return googleFormsData;
	}

	function captureGmailData(): GmailData {
		const gmailData: GmailData = {
			screenshot: null,
		};
		return gmailData;
	}

	function captureArticleData(): ArticleData {
		const scrollPositionPercent = Math.round(
			(window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
		);
		// Visible text in this context means the first 500 characters that are currently visible
		const centerElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
		let visibleText = "";
		if (centerElement) {
			const textContainer = centerElement.closest("p, h2, h3") || centerElement;
			visibleText = textContainer.textContent?.trim().slice(0, 1000) || "";
		}
		const articleData: ArticleData = {
			scrollPositionPercent,
			visibleText,
		};
		return articleData;
	}

	function captureSearchData(): SearchData {
		const searchQuery = new URL(window.location.href).searchParams.get("q") || "";
		const searchEngine = window.location.href.includes("google.com")
			? "Google"
			: window.location.href.includes("bing.com")
			? "Bing"
			: window.location.href.includes("duckduckgo.com")
			? "DuckDuckGo"
			: "unknown";
		const links = document.querySelectorAll("#search span a, h2 a, h3 a");
		const searchResults: SearchResultData[] = Array.from(links).map((link) => ({
			title: link.textContent?.trim() || "Untitled",
			url: (link as HTMLAnchorElement).href,
			// TODO Implement a way to track whether a link has been clicked or not in the past for a better analysis
			isClicked: false,
		}));
		const searchData: SearchData = {
			searchQuery,
			searchResults,
			searchEngine,
		};
		return searchData;
	}
	const detection = detectPageType();
	const snapshot: PageSnapshot = {
		url: window.location.href,
		title: document.title,
		timestamp: Date.now(),
		type: detection.type,
	};
	console.log("[NORO] Snapshot captured (pre-screenshot): ", snapshot);
	switch (snapshot.type) {
		case "google-docs":
			snapshot.data = captureGoogleDocsData();
			break;
		case "google-sheets":
			snapshot.data = captureGoogleSheetsData();
			break;
		case "google-slides":
			snapshot.data = captureGoogleSlidesData();
			break;
		case "google-forms":
			snapshot.data = captureGoogleFormsData();
			break;
		case "gmail":
			snapshot.data = captureGmailData();
			break;
		case "search":
			snapshot.data = captureSearchData();
			break;
		case "article":
			snapshot.data = captureArticleData();
			break;
		default:
			snapshot.data = undefined;
			break;
	}
	return snapshot;
}

async function submitWorkspaceToAWS(workspace: WorkspaceCapture): Promise<void> {
	const timestamp = new Date().toISOString();
	try {
		console.log(`[NORO] ${timestamp} - Step 3/8: Starting AWS submission process...`);
		const awsService = AWSAPIService.getInstance();

		// Check if we should submit (rate limiting)
		console.log(`[NORO] ${new Date().toISOString()} - Step 3.1/8: Checking rate limits...`);
		const shouldSubmit = await awsService.shouldSubmitContext();
		console.log(`[NORO] ${new Date().toISOString()} - Rate limit check result: ${shouldSubmit}`);
		if (!shouldSubmit) {
			console.log(`[NORO] ${new Date().toISOString()} - ❌ BLOCKED: AWS submission skipped due to rate limiting`);
			// Get more details about rate limiting
			const rateLimitData = await chrome.storage.local.get([
				"last_aws_submission",
				"aws_requests_minute",
				"aws_requests_hour",
				"aws_minute_start",
				"aws_hour_start",
			]);
			console.log(`[NORO] ${new Date().toISOString()} - Rate limit details:`, rateLimitData);
			return;
		}
		console.log(`[NORO] ${new Date().toISOString()} - ✅ Rate limits OK, proceeding with submission`);

		// Get user ID
		console.log(`[NORO] ${new Date().toISOString()} - Step 3.2/8: Retrieving user ID...`);
		const settings = await chrome.storage.sync.get(["userId"]);
		console.log(`[NORO] ${new Date().toISOString()} - Retrieved settings:`, {
			userId: settings.userId ? `${settings.userId.slice(0, 8)}...` : null,
		});
		if (!settings.userId) {
			console.log(`[NORO] ${new Date().toISOString()} - ❌ BLOCKED: No user ID found, skipping AWS submission`);
			console.log(`[NORO] ${new Date().toISOString()} - Full settings object:`, settings);
			return;
		}
		console.log(`[NORO] ${new Date().toISOString()} - ✅ User ID found: ${settings.userId.slice(0, 8)}...`);

		// Check API health first
		console.log(`[NORO] ${new Date().toISOString()} - Step 3.3/8: Checking API health...`);
		const health = await awsService.checkHealth();
		console.log(`[NORO] ${new Date().toISOString()} - Health check result:`, health);
		if (!health || health.status !== "healthy") {
			console.log(
				`[NORO] ${new Date().toISOString()} - ❌ BLOCKED: API unhealthy, skipping submission. Health result:`,
				health
			);
			return;
		}
		console.log(`[NORO] ${new Date().toISOString()} - ✅ API health check passed, proceeding`);

		// Submit workspace context
		console.log(`[NORO] ${new Date().toISOString()} - Step 4/8: Submitting workspace context to AWS...`);
		const contextId = await awsService.submitContext(workspace, settings.userId, "idle");
		if (contextId) {
			console.log(
				`[NORO] ${new Date().toISOString()} - Step 5/8: Successfully submitted workspace to AWS with context ID: ${contextId}`
			);

			// Update badge to show context is being processed
			console.log(`[NORO] ${new Date().toISOString()} - Step 6/8: Updating icon to processing state`);
			await updateExtensionBadge("processing");
			await sendCaptureStatus("processing");

			// Wait a few seconds, then get analyzed context and insights
			console.log(
				`[NORO] ${new Date().toISOString()} - Step 7/8: Scheduling context and insights fetch in 5 seconds...`
			);
			setTimeout(async () => {
				console.log(
					`[NORO] ${new Date().toISOString()} - Step 8/8: Starting context and insights fetch for ID: ${contextId}`
				);
				await fetchAnalyzedContextAndInsights(contextId, settings.userId);
			}, 5000); // Wait 5 seconds for AI processing as specified
		} else {
			console.log(`[NORO] ${new Date().toISOString()} - Step 4/8 FAILED: AWS submission returned null/failed`);
		}
	} catch (error) {
		console.error(`[NORO] ${new Date().toISOString()} - AWS submission error in step 3-4:`, error);
	}
}

async function sendCaptureStatus(status: "capturing" | "processing" | "paused" | null): Promise<void> {
	try {
		await chrome.runtime.sendMessage({
			action: "captureStatus",
			status: status,
		} as ChromeMessage);
	} catch (error) {
		// Popup might not be open, ignore the error
		console.log("[NORO] Could not send capture status (popup not open)");
	}
}

async function updateExtensionBadge(state: "idle" | "tracking" | "processing" | "insights" | "offline"): Promise<void> {
	try {
		switch (state) {
			case "idle":
				await chrome.action.setIcon({
					path: {
						"16": chrome.runtime.getURL("public/assets/icons/idle/icon_idle_16.png"),
						"32": chrome.runtime.getURL("public/assets/icons/idle/icon_idle_32.png"),
						"48": chrome.runtime.getURL("public/assets/icons/idle/icon_idle_48.png"),
						"128": chrome.runtime.getURL("public/assets/icons/idle/icon_idle_128.png"),
					},
				});
				await chrome.action.setBadgeText({ text: "" });
				break;
			case "tracking":
				await chrome.action.setIcon({
					path: {
						"16": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_16.png"),
						"32": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_32.png"),
						"48": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_48.png"),
						"128": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_128.png"),
					},
				});
				await chrome.action.setBadgeText({ text: "" });
				break;
			case "processing":
				await chrome.action.setIcon({
					path: {
						"16": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_16.png"),
						"32": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_32.png"),
						"48": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_48.png"),
						"128": chrome.runtime.getURL("public/assets/icons/tracking/icon_tracking_128.png"),
					},
				});
				await chrome.action.setBadgeText({ text: "" });
				break;
			case "insights":
				await chrome.action.setIcon({
					path: {
						"16": chrome.runtime.getURL(
							"public/assets/icons/context_available/icon_contextavailable_16.png"
						),
						"32": chrome.runtime.getURL(
							"public/assets/icons/context_available/icon_contextavailable_32.png"
						),
						"48": chrome.runtime.getURL(
							"public/assets/icons/context_available/icon_contextavailable_48.png"
						),
						"128": chrome.runtime.getURL(
							"public/assets/icons/context_available/icon_contextavailable_128.png"
						),
					},
				});
				await chrome.action.setBadgeText({ text: "" });
				break;
			case "offline":
				await chrome.action.setIcon({
					path: {
						"16": chrome.runtime.getURL("public/assets/icons/offline/icon_offline_16.png"),
						"32": chrome.runtime.getURL("public/assets/icons/offline/icon_offline_32.png"),
						"48": chrome.runtime.getURL("public/assets/icons/offline/icon_offline_48.png"),
						"128": chrome.runtime.getURL("public/assets/icons/offline/icon_offline_128.png"),
					},
				});
				await chrome.action.setBadgeText({ text: "" });
				break;
		}
		console.log(`[NORO] Extension icon updated to: ${state}`);
	} catch (error) {
		console.error("[NORO] Failed to update badge:", error);
	}
}

async function fetchAnalyzedContextAndInsights(contextId: string, userId: string): Promise<void> {
	try {
		console.log(
			`[NORO] ${new Date().toISOString()} - Starting context and insights fetch for context ID: ${contextId}`
		);

		const awsService = AWSAPIService.getInstance();

		// Step 1: Get analyzed context from the GET context route
		console.log(`[NORO] ${new Date().toISOString()} - Fetching analyzed context...`);
		const analyzedContext = await awsService.getAnalyzedContext(contextId);

		if (analyzedContext) {
			console.log(
				`[NORO] ${new Date().toISOString()} - Successfully retrieved analyzed context:`,
				analyzedContext
			);
		} else {
			console.log(`[NORO] ${new Date().toISOString()} - No analyzed context available yet for ID: ${contextId}`);
		}

		// Step 2: Get insights from the insights route
		console.log(`[NORO] ${new Date().toISOString()} - Fetching insights for user: ${userId}...`);
		const insights = await awsService.getInsights(userId, 5);

		console.log(`[NORO] ${new Date().toISOString()} - Retrieved ${insights.length} insights`);

		if (insights.length > 0) {
			console.log(
				`[NORO] ${new Date().toISOString()} - Processing insights:`,
				insights.map((i) => ({ title: i.title, priority: i.priority }))
			);

			// Show badge for new insights
			await updateExtensionBadge("insights");

			// Show notification for high priority insights
			console.log(
				`[NORO] ${new Date().toISOString()} - 🔍 Checking ${insights.length} insights for notifications`
			);
			insights.forEach((insight, idx) => {
				console.log(
					`[NORO] ${new Date().toISOString()} - Insight ${idx + 1}: "${insight.title}" (priority: ${
						insight.priority
					})`
				);
			});

			const highPriorityInsights = insights.filter((i) => i.priority === "high");
			if (highPriorityInsights.length > 0) {
				console.log(
					`[NORO] ${new Date().toISOString()} - Found ${
						highPriorityInsights.length
					} high priority insights, showing notification`
				);
				await showContextReadyNotification(highPriorityInsights[0]);
			} else {
				console.log(
					`[NORO] ${new Date().toISOString()} - No high priority insights found, skipping notification`
				);
			}

			// Clear insights badge after 2 minutes
			setTimeout(async () => {
				console.log(`[NORO] ${new Date().toISOString()} - Clearing insights badge, returning to idle state`);
				await updateExtensionBadge("idle");
			}, 120000);
		} else {
			// No insights, clear processing badge
			console.log(`[NORO] ${new Date().toISOString()} - No insights available, returning to idle state`);
			await updateExtensionBadge("idle");
		}
	} catch (error) {
		console.error(`[NORO] ${new Date().toISOString()} - Failed to fetch context and insights:`, error);
		await updateExtensionBadge("offline");

		// Clear offline badge after 1 minute
		setTimeout(async () => {
			console.log(
				`[NORO] ${new Date().toISOString()} - Clearing offline badge after error, returning to idle state`
			);
			await updateExtensionBadge("idle");
		}, 60000);
	}
}

async function checkForNewInsights(userId: string): Promise<void> {
	try {
		const awsService = AWSAPIService.getInstance();
		const insights = await awsService.getInsights(userId, 5);

		if (insights.length > 0) {
			// Show badge for new insights
			await updateExtensionBadge("insights");

			// Show notification for high priority insights
			console.log(
				`[NORO] ${new Date().toISOString()} - 🔍 Checking ${
					insights.length
				} insights for notifications (retry context)`
			);
			insights.forEach((insight, idx) => {
				console.log(
					`[NORO] ${new Date().toISOString()} - Insight ${idx + 1}: "${insight.title}" (priority: ${
						insight.priority
					})`
				);
			});

			const highPriorityInsights = insights.filter((i) => i.priority === "high");
			if (highPriorityInsights.length > 0) {
				console.log(
					`[NORO] ${new Date().toISOString()} - Found ${
						highPriorityInsights.length
					} high priority insights in retry, showing notification`
				);
				await showContextReadyNotification(highPriorityInsights[0]);
			} else {
				console.log(
					`[NORO] ${new Date().toISOString()} - No high priority insights found in retry, skipping notification`
				);
			} // Clear insights badge after 2 minutes
			setTimeout(async () => {
				await updateExtensionBadge("idle");
			}, 120000);
		} else {
			// No insights, clear processing badge
			await updateExtensionBadge("idle");
		}
	} catch (error) {
		console.error("[NORO] Failed to check for insights:", error);
		await updateExtensionBadge("offline");

		// Clear offline badge after 1 minute
		setTimeout(async () => {
			await updateExtensionBadge("idle");
		}, 60000);
	}
}

async function showContextReadyNotification(insight: AIInsight): Promise<void> {
	try {
		const settings = await chrome.storage.sync.get(["notificationsEnabled"]);
		console.log(`[NORO] ${new Date().toISOString()} - 🔔 Notification settings check:`, settings);

		// Default to enabled if not explicitly set
		const notificationsEnabled = settings.notificationsEnabled !== false;
		console.log(`[NORO] ${new Date().toISOString()} - 🔔 Notifications enabled: ${notificationsEnabled}`);

		if (!notificationsEnabled) {
			console.log(
				`[NORO] ${new Date().toISOString()} - 🚫 Notifications disabled by user, skipping notification`
			);
			return;
		}

		console.log(`[NORO] ${new Date().toISOString()} - 📢 Creating notification for insight:`, {
			title: insight.title,
			priority: insight.priority,
			description: insight.description,
		});

		// Check if we have notification permission
		const hasPermission = await chrome.permissions.contains({ permissions: ["notifications"] });
		console.log(`[NORO] ${new Date().toISOString()} - 🔔 Has notification permission: ${hasPermission}`);

		const notificationId = `noro_notification_${Date.now()}`;
		console.log(`[NORO] ${new Date().toISOString()} - 🔔 Creating notification with ID: ${notificationId}`);

		const createdId = await chrome.notifications.create(notificationId, {
			type: "basic",
			iconUrl: chrome.runtime.getURL("public/assets/icons/context_available/icon_contextavailable_48.png"),
			title: "Noro - Context Ready",
			message: insight.title || "New insight available!",
		});

		console.log(`[NORO] ${new Date().toISOString()} - ✅ Notification created successfully with ID:`, createdId);

		console.log("[NORO] Notification sent:", insight.title);
	} catch (error) {
		console.error("[NORO] Failed to show notification:", error);
	}
}

// Notification event listeners
chrome.notifications.onClicked?.addListener((notificationId) => {
	console.log(`[NORO] ${new Date().toISOString()} - 📢 Notification clicked:`, notificationId);
	chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed?.addListener((notificationId, byUser) => {
	console.log(`[NORO] ${new Date().toISOString()} - 📢 Notification closed:`, notificationId, "by user:", byUser);
});

initializeExtension();

console.log("[NORO] Ready! Cleanup active, retention:", DEFAULT_EXPIRATION.retentionMs / (24 * 60 * 60 * 1000), "days");
