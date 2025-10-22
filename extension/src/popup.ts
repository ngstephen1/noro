import {
	WorkspaceCapture,
	WindowSnapshot,
	TabSnapshot,
	PageSnapshot,
	UserSettings,
	TaskInfo,
	IconConfig,
	ChromeMessage,
	AIInsight,
	Activity,
	ContextResponse,
} from "./types.js";
import AWSAPIService from "./awsService.js";

// State management
let currentWorkspace: WorkspaceCapture | null = null;
let isTracking: boolean = true;

document.addEventListener("DOMContentLoaded", async () => {
	await loadRealData();
	setupEventListeners();
	startStatusUpdates();

	// Listen for capture status updates from background
	chrome.runtime.onMessage.addListener((message: ChromeMessage) => {
		if (message.action === "captureStatus") {
			// Ensure status is properly typed or default to null
			const status = message.status ?? null;
			showTrackingStatus(status);
		}
	});
});

async function loadRealData(): Promise<void> {
	try {
		const settings = (await chrome.storage.sync.get({
			isActive: true,
			idleTime: 15,
			retentionDays: 7,
		})) as UserSettings;

		isTracking = settings.isActive;

		const idleSlider = document.getElementById("idleSlider") as HTMLInputElement;
		const idleValue = document.getElementById("idleValue") as HTMLElement;
		const retentionSelect = document.getElementById("retentionSelect") as HTMLSelectElement;

		if (idleSlider) {
			idleSlider.value = settings.idleTime.toString();
		}
		if (idleValue) {
			idleValue.textContent = settings.idleTime + "s";
		}
		if (retentionSelect) {
			retentionSelect.value = settings.retentionDays.toString();
		}

		const allData = await chrome.storage.local.get(null);
		const workspaces: WorkspaceCapture[] = Object.entries(allData)
			.filter(([key]) => key.startsWith("workspace_"))
			.map(([key, value]) => ({ key, ...(value as WorkspaceCapture) }))
			.sort((a, b) => b.timestamp - a.timestamp);

		console.log("[POPUP] Found", workspaces.length, "workspaces");
		if (workspaces.length > 0) {
			console.log("[POPUP] First workspace:", workspaces[0]);
		}

		if (workspaces.length > 0) {
			currentWorkspace = workspaces[0];
			console.log("[POPUP] Calling displayWorkspaceData");
			displayWorkspaceData(workspaces);
		} else {
			console.log("[POPUP] No workspaces found, creating sample data for testing");
			const sampleWorkspaces = createSampleWorkspaces();
			if (sampleWorkspaces.length > 0) {
				currentWorkspace = sampleWorkspaces[0];
				displayWorkspaceData(sampleWorkspaces);
			} else {
				displayEmptyState();
			}
		}

		updateStatusDisplay();
	} catch (error) {
		console.error("[POPUP] Failed to load data:", error);
		displayEmptyState();
	}
}

function displayWorkspaceData(workspaces: WorkspaceCapture[]): void {
	console.log("[POPUP] displayWorkspaceData called with", workspaces.length, "workspaces");

	const latest = workspaces[0];
	const timeSinceCapture = Date.now() - latest.timestamp;
	const hoursAgo = Math.floor(timeSinceCapture / (1000 * 60 * 60));
	const minsAgo = Math.floor((timeSinceCapture % (1000 * 60 * 60)) / (1000 * 60));

	updateStatusMessage(hoursAgo, minsAgo);
	console.log("[POPUP] About to display main task card");
	displayMainTaskCard(latest);
	console.log("[POPUP] About to display recent tasks");
	displayNewRecentTasks(workspaces.slice(0, 6));
	console.log("[POPUP] About to display suggested tasks");
	displayNewSuggestedTasks(workspaces.slice(1, 4));
	console.log("[POPUP] displayWorkspaceData complete");
}

function updateStatusMessage(hours: number, mins: number): void {
	const statusMessage = document.querySelector(".status-message") as HTMLElement;
	const statusSubtitle = document.querySelector(".status-subtitle") as HTMLElement;

	if (!statusMessage || !statusSubtitle) return;

	if (hours === 0 && mins < 30) {
		statusMessage.textContent = "Welcome back!";
		statusSubtitle.textContent = "Your recent context is ready for recovery.";
	} else if (hours === 0) {
		statusMessage.textContent = "Context available!";
		statusSubtitle.textContent = `Last activity was ${mins} minutes ago.`;
	} else if (hours < 24) {
		statusMessage.textContent = "All caught up!";
		statusSubtitle.textContent = `Last context from ${hours}h ${mins}m ago.`;
	} else {
		statusMessage.textContent = "All caught up!";
		statusSubtitle.textContent = "You currently don't have any notifications.";
	}
}

function displayContentAvailable(workspace: WorkspaceCapture): void {
	let contentSection = document.querySelector(".content-available") as HTMLElement;
	if (!contentSection) {
		const section = createSection("Content Available", "content-available");
		const welcomeBack = document.querySelector(".welcome-back")?.parentNode;
		if (welcomeBack) {
			welcomeBack.appendChild(section);
		}
		contentSection = section;
	}

	const existingCards = contentSection.querySelectorAll(".task-card");
	existingCards.forEach((card) => card.remove());

	const activeTabs = workspace.windows
		.flatMap((w) => w.tabs.filter((t) => t.isActive))
		.filter((t) => t.snapshot.type !== "general");

	if (activeTabs.length > 0) {
		const mainTask = activeTabs[0];
		displayMainTask(mainTask, workspace.timestamp, contentSection);
	}
}

async function displayAIInsights(): Promise<void> {
	try {
		console.log(`[POPUP] ${new Date().toISOString()} - Starting AI insights and activities display...`);

		const settings = await chrome.storage.sync.get(["userId"]);
		if (!settings.userId) {
			console.log(`[POPUP] ${new Date().toISOString()} - No user ID found, skipping display`);
			showEmptyInsightsState();
			return;
		}

		console.log(`[POPUP] ${new Date().toISOString()} - User ID found: ${settings.userId.slice(0, 8)}...`);
		const awsService = AWSAPIService.getInstance();

		// Display recent activities first
		await displayRecentActivities();

		// First try to get cached insights for immediate display
		console.log(`[POPUP] ${new Date().toISOString()} - Checking for cached insights...`);
		const cachedInsights = await awsService.getCachedInsights();
		if (cachedInsights.length > 0) {
			console.log(
				`[POPUP] ${new Date().toISOString()} - Found ${
					cachedInsights.length
				} cached insights, displaying first 3`
			);
			renderAIInsights(cachedInsights.slice(0, 3));
		} else {
			console.log(`[POPUP] ${new Date().toISOString()} - No cached insights found`);
		}

		// Then fetch fresh insights in the background
		console.log(`[POPUP] ${new Date().toISOString()} - Fetching fresh insights from AWS...`);
		awsService
			.getInsights(settings.userId, 3)
			.then((insights) => {
				if (insights.length > 0) {
					console.log(
						`[POPUP] ${new Date().toISOString()} - Received ${
							insights.length
						} fresh insights, updating display`
					);
					renderAIInsights(insights);
				} else {
					console.log(`[POPUP] ${new Date().toISOString()} - No fresh insights received`);
				}
			})
			.catch((error) => {
				console.error(`[POPUP] ${new Date().toISOString()} - Failed to fetch AI insights:`, error);
			});
	} catch (error) {
		console.error(`[POPUP] ${new Date().toISOString()} - Failed to display AI insights:`, error);
	}
}

function renderAIInsights(insights: AIInsight[]): void {
	console.log(`[POPUP] ${new Date().toISOString()} - Rendering ${insights.length} AI insights in popup`);

	let insightsSection = document.querySelector(".ai-insights-section") as HTMLElement;
	if (!insightsSection) {
		console.log(`[POPUP] ${new Date().toISOString()} - Creating new insights section in popup`);
		insightsSection = createSection("💡 AI Insights", "ai-insights-section");
		const contentSection = document.querySelector(".content-available");
		if (contentSection?.parentNode) {
			contentSection.parentNode.insertBefore(insightsSection, contentSection.nextSibling);
		} else {
			document.body.appendChild(insightsSection);
		}
	}

	// Clear existing insights
	const existingInsights = insightsSection.querySelectorAll(".insight-card");
	console.log(`[POPUP] ${new Date().toISOString()} - Clearing ${existingInsights.length} existing insight cards`);
	existingInsights.forEach((card) => card.remove());

	insights.forEach((insight, index) => {
		console.log(
			`[POPUP] ${new Date().toISOString()} - Rendering insight ${index + 1}: "${insight.title}" (priority: ${
				insight.priority
			})`
		);
		const insightCard = createInsightCard(insight);
		insightsSection.appendChild(insightCard);
	});

	console.log(`[POPUP] ${new Date().toISOString()} - AI insights rendering complete`);
}

function createInsightCard(insight: AIInsight): HTMLElement {
	const card = document.createElement("div");
	card.className = "suggestion-card insight-card";

	const priorityColor =
		insight.priority === "high" ? "#ef4444" : insight.priority === "medium" ? "#f59e0b" : "#10b981";

	const typeIconPath =
		insight.insight_type === "task_continuation"
			? "public/assets/icons/tracking/icon_tracking_16.png"
			: insight.insight_type === "context_switch"
			? "public/assets/icons/offline/icon_offline_16.png"
			: insight.insight_type === "productivity_pattern"
			? "public/assets/icons/context_available/icon_contextavailable_16.png"
			: "public/assets/icons/idle/icon_idle_16.png";

	// Determine button text
	const buttonText =
		insight.suggested_actions && insight.suggested_actions.length > 0
			? insight.suggested_actions[0] || getInsightActionText(insight)
			: getInsightActionText(insight);

	card.innerHTML = `
		<div class="task-header">
			<div class="task-icon" style="background: ${priorityColor}20;">
				<img src="${typeIconPath}" alt="Insight" style="width: 16px; height: 16px;">
			</div>
			<div class="task-title">${insight.title}</div>
			<div class="task-time">${Math.round(insight.confidence * 100)}%</div>
		</div>
		<div class="task-context">AI Analysis</div>
		<div class="task-description">${insight.description}</div>
		<div class="task-actions">
			<button class="primary" onclick="handleInsightAction('${insight.id}')">
				${buttonText}
			</button>
		</div>
	`;

	return card;
}

function getInsightActionText(insight: AIInsight): string {
	switch (insight.insight_type) {
		case "task_continuation":
			return "Resume Task";
		case "context_switch":
			return "Switch Context";
		case "productivity_pattern":
			return "View Pattern";
		case "suggestion":
			return "Apply Suggestion";
		default:
			return "Open Task";
	}
}

function displayMainTask(tab: TabSnapshot, timestamp: number, container: HTMLElement): void {
	const taskCard = createTaskCard(tab, timestamp, true);
	container.appendChild(taskCard);
}

function createTaskCard(tab: TabSnapshot, timestamp: number, isPrimary: boolean = false): HTMLElement {
	const card = document.createElement("div");
	card.className = isPrimary ? "task-card" : "suggestion-card";

	const iconMap: Record<string, IconConfig> = {
		"google-docs": { emoji: "📄", class: "docs" },
		"google-sheets": { emoji: "📊", class: "sheets" },
		"google-slides": { emoji: "📈", class: "slides" },
		gmail: { emoji: "📧", class: "email" },
		article: { emoji: "📰", class: "docs" },
		search: { emoji: "🔍", class: "docs" },
	};

	const icon = iconMap[tab.snapshot.type] || { emoji: "📄", class: "docs" };
	const timeAgo = getTimeAgo(timestamp);
	const taskInfo = getTaskInfo(tab);

	card.innerHTML = `
		<div class="task-header">
			<div class="task-icon ${icon.class}">${icon.emoji}</div>
			<div class="task-title">${taskInfo.title}</div>
			${isPrimary ? "" : `<div class="task-time">${timeAgo}</div>`}
		</div>
		<div class="task-context">Last edit: ${taskInfo.context}</div>
		<div class="task-description">Task: ${taskInfo.task}</div>
		<div class="task-actions">
			<button class="primary task-resume" data-url="${tab.snapshot.url}">
				${isPrimary ? "Resume Task" : "Open"}
			</button>
			<button class="secondary task-dismiss">
				${isPrimary ? "Show More" : "Dismiss"}
			</button>
		</div>
	`;

	const resumeBtn = card.querySelector(".task-resume") as HTMLButtonElement;
	const dismissBtn = card.querySelector(".task-dismiss") as HTMLButtonElement;

	if (resumeBtn) {
		resumeBtn.addEventListener("click", () => {
			const url = resumeBtn.dataset.url;
			if (url) {
				openOrSwitchToTab(url);
			}
		});
	}

	if (dismissBtn) {
		dismissBtn.addEventListener("click", () => {
			if (isPrimary) {
				// Open the history page
				chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
				window.close();
			} else {
				// Dismiss - remove this suggestion card
				card.remove();
			}
		});
	}

	return card;
}

function getTaskInfo(tab: TabSnapshot): TaskInfo {
	const data = tab.snapshot.data;
	const type = tab.snapshot.type;

	switch (type) {
		case "google-docs":
			return {
				title: data?.documentName || "Unknown Document",
				context: "Added notes to page 3",
				task: "Continue editing page 4",
			};
		case "google-sheets":
			return {
				title: data?.workbook || "Unknown Workbook",
				context: `Cell ${data?.selectedRange || "A1"}`,
				task: "Final review",
			};
		case "google-slides":
			return {
				title: data?.presentationName || "Unknown Presentation",
				context: "Added notes to slide 3",
				task: "Continue editing slide 4",
			};
		case "gmail":
			return {
				title: "Email with Mohammad",
				context: "Drafted response",
				task: "Review and send",
			};
		case "article":
			return {
				title: tab.snapshot.title.slice(0, 50) + "...",
				context: `Reading (${data?.scrollPositionPercent || 0}% complete)`,
				task: "Continue reading",
			};
		case "search":
			return {
				title: `Search: ${data?.searchQuery || "Unknown"}`,
				context: `${data?.searchEngine || "Search"} search`,
				task: "Continue research",
			};
		default:
			return {
				title: tab.snapshot.title.slice(0, 50),
				context: "Browsing",
				task: "Continue",
			};
	}
}

function displaySuggestedTasks(workspaces: WorkspaceCapture[]): void {
	let suggestedSection = document.querySelector(".suggested-section") as HTMLElement;
	if (!suggestedSection) {
		suggestedSection = createSection("Suggested for you", "suggested-section");
		document.body.appendChild(suggestedSection);
	}

	suggestedSection.innerHTML = '<div class="section-title">Suggested for you</div>';

	workspaces.forEach((workspace) => {
		const activeTabs = workspace.windows.flatMap((w) => w.tabs.filter((t) => t.isActive));
		if (activeTabs.length > 0) {
			const suggestionCard = createTaskCard(activeTabs[0], workspace.timestamp);
			suggestedSection.appendChild(suggestionCard);
		}
	});
}

function displayRecentTasks(workspaces: WorkspaceCapture[]): void {
	let recentSection = document.querySelector(".recent-section") as HTMLElement;
	if (!recentSection) {
		recentSection = createSection("Recent tasks", "recent-section");
		document.body.appendChild(recentSection);
	}

	recentSection.innerHTML = '<div class="section-title">Recent tasks</div>';

	workspaces.forEach((workspace) => {
		workspace.windows.forEach((window) => {
			window.tabs
				.filter((t) => t.snapshot.type !== "general")
				.forEach((tab) => {
					const recentItem = createRecentItem(tab, workspace.timestamp);
					recentSection.appendChild(recentItem);
				});
		});
	});
}

function createRecentItem(tab: TabSnapshot, timestamp: number): HTMLElement {
	const item = document.createElement("div");
	item.className = "recent-item";

	const taskInfo = getTaskInfo(tab);
	const timeAgo = getTimeAgo(timestamp);
	const iconMap: Record<string, IconConfig> = {
		"google-docs": { emoji: "📄", class: "docs" },
		"google-sheets": { emoji: "📊", class: "sheets" },
		"google-slides": { emoji: "📈", class: "slides" },
		gmail: { emoji: "📧", class: "email" },
		article: { emoji: "📰", class: "docs" },
		search: { emoji: "🔍", class: "docs" },
	};
	const icon = iconMap[tab.snapshot.type] || { emoji: "📄", class: "docs" };

	item.innerHTML = `
		<div class="task-header">
			<div class="task-icon ${icon.class}">${icon.emoji}</div>
			<div class="task-title">${taskInfo.title}</div>
			<div class="task-time">${timeAgo}</div>
		</div>
		<div class="task-context">${taskInfo.context}</div>
		<div class="task-description">${taskInfo.task}</div>
		<div class="task-actions" style="margin-top: 8px;">
			<button class="primary" style="font-size: 14px; padding: 6px 12px;">Open</button>
		</div>
	`;

	// Add click handler for the open button
	const openBtn = item.querySelector(".primary") as HTMLButtonElement;
	if (openBtn) {
		openBtn.addEventListener("click", () => {
			openOrSwitchToTab(tab.snapshot.url);
		});
	}

	// Make the entire item clickable as well
	item.style.cursor = "pointer";
	item.addEventListener("click", (e) => {
		// Don't trigger if clicking the button
		if (e.target !== openBtn) {
			openOrSwitchToTab(tab.snapshot.url);
		}
	});

	return item;
}

function createSection(title: string, className: string): HTMLElement {
	const section = document.createElement("div");
	section.className = `section ${className}`;
	section.innerHTML = `<div class="section-title">${title}</div>`;
	return section;
}

function displayEmptyState(): void {
	console.log("[POPUP] displayEmptyState called");

	const statusMessage = document.querySelector(".status-message") as HTMLElement;
	const statusSubtitle = document.querySelector(".status-subtitle") as HTMLElement;

	if (statusMessage) statusMessage.textContent = "All caught up!";
	if (statusSubtitle) statusSubtitle.textContent = "No recent activity to show.";

	const trackingStatus = document.querySelector(".tracking-status") as HTMLElement;
	if (trackingStatus) trackingStatus.style.display = "none";

	// Show empty state in new layout
	displayEmptyMainTaskCard();
	displayEmptyRecentTasks();
	displayEmptySuggestedTasks();
}

function displayEmptyMainTaskCard(): void {
	const mainTaskCard = document.getElementById("mainTaskCard");
	if (!mainTaskCard) return;

	mainTaskCard.innerHTML = `
		<div class="welcome-back">
			<div class="welcome-title">Welcome back! 😊</div>
		</div>
		<div class="main-task-card" style="text-align: center; padding: 40px 20px; border: 2px dashed #e5e7eb; background: #f9fafb;">
			<div style="font-size: 48px; margin-bottom: 16px;">🌟</div>
			<div style="font-size: 18px; font-weight: 600; color: #6b7280; margin-bottom: 8px;">No active tasks</div>
			<div style="font-size: 14px; color: #9ca3af;">Start working and Noro will track your progress</div>
		</div>
	`;
}

function displayEmptyRecentTasks(): void {
	const recentTasksList = document.querySelector(".recent-tasks-list");
	if (!recentTasksList) return;

	recentTasksList.innerHTML = `
		<div style="text-align: center; padding: 40px 20px; color: #6b7280;">
			<div style="font-size: 32px; margin-bottom: 12px;">📋</div>
			<div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">No recent tasks</div>
			<div style="font-size: 12px; color: #9ca3af;">Your recent activity will appear here</div>
		</div>
	`;
}

function displayEmptySuggestedTasks(): void {
	const suggestedContainer = document.getElementById("suggestedTasks");
	if (!suggestedContainer) return;

	suggestedContainer.innerHTML = `
		<div class="suggested-section">
			<div class="suggested-header">
				<div class="suggested-title">Suggested for you 💡</div>
			</div>
			<div style="text-align: center; padding: 20px; color: #6b7280;">
				<div style="font-size: 24px; margin-bottom: 8px;">🤖</div>
				<div style="font-size: 14px;">AI suggestions will appear here based on your work patterns</div>
			</div>
		</div>
	`;
}

function updateStatusDisplay(): void {
	const statusBadge = document.querySelector(".status-badge span") as HTMLElement;
	const statusDot = document.querySelector(".status-dot") as HTMLElement;

	if (statusBadge) {
		statusBadge.textContent = isTracking ? "Active" : "Paused";
	}

	if (statusDot) {
		statusDot.style.background = isTracking ? "#10b981" : "#ef4444";
	}

	// Only show paused status when tracking is disabled
	showTrackingStatus(isTracking ? null : "paused");
}

function showTrackingStatus(status: "capturing" | "processing" | "paused" | null): void {
	console.log(`[POPUP] ${new Date().toISOString()} - Tracking status updated to: ${status}`);

	const trackingStatus = document.querySelector(".tracking-status") as HTMLElement;

	if (!trackingStatus) {
		console.log(`[POPUP] ${new Date().toISOString()} - Tracking status element not found`);
		return;
	}

	if (status === null) {
		console.log(`[POPUP] ${new Date().toISOString()} - Hiding tracking status display`);
		trackingStatus.style.display = "none";

		// When status clears, refresh insights as processing may have completed
		setTimeout(() => {
			console.log(`[POPUP] ${new Date().toISOString()} - Status cleared, refreshing insights display`);
			displayAIInsights();
		}, 1000);
		return;
	}

	console.log(`[POPUP] ${new Date().toISOString()} - Showing tracking status: ${status}`);
	trackingStatus.style.display = "block";

	switch (status) {
		case "capturing":
			trackingStatus.innerHTML = "<strong>📸 Capturing:</strong> Analyzing your workspace...";
			trackingStatus.style.background = "#fef3c7";
			trackingStatus.style.color = "#92400e";
			console.log(`[POPUP] ${new Date().toISOString()} - Status display: Workspace capture in progress`);
			break;
		case "processing":
			trackingStatus.innerHTML = "<strong>🧠 Processing:</strong> AI is analyzing your context...";
			trackingStatus.style.background = "#e0f2fe";
			trackingStatus.style.color = "#0369a1";
			console.log(`[POPUP] ${new Date().toISOString()} - Status display: AI processing context`);
			break;
		case "paused":
			trackingStatus.innerHTML = "<strong>⏸️ Paused:</strong> Privacy mode active. Click Resume to continue.";
			trackingStatus.style.background = "#fef2f2";
			trackingStatus.style.color = "#dc2626";
			console.log(`[POPUP] ${new Date().toISOString()} - Status display: Extension paused`);
			break;
	}
}

function getTimeAgo(timestamp: number): string {
	console.log("[POPUP] getTimeAgo called with timestamp:", timestamp, "Date.now():", Date.now());

	// Handle case where timestamp might be in seconds instead of milliseconds
	let adjustedTimestamp = timestamp;
	if (timestamp < 1000000000000) {
		// If timestamp appears to be in seconds (before year 2001 in ms)
		adjustedTimestamp = timestamp * 1000;
		console.log("[POPUP] Converted timestamp from seconds to milliseconds:", adjustedTimestamp);
	}

	const diff = Date.now() - adjustedTimestamp;
	console.log("[POPUP] Time difference:", diff, "ms");

	const hours = Math.floor(diff / (1000 * 60 * 60));
	const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

	console.log("[POPUP] Calculated time: ", hours, "hours,", mins, "minutes");

	if (diff < 0) return "just now"; // Handle future timestamps
	if (hours === 0) return `${mins} mins ago`;
	if (hours < 24) return `${hours}hrs ago`;

	const days = Math.floor(hours / 24);
	return `${days} days ago`;
}

async function openOrSwitchToTab(url: string): Promise<void> {
	try {
		// Query all tabs to find if the URL is already open
		const tabs = await chrome.tabs.query({});

		// Function to normalize URLs for comparison (especially useful for Google Workspace)
		const normalizeUrl = (url: string): string => {
			try {
				const urlObj = new URL(url);
				// For Google Docs/Sheets/Slides, remove certain query parameters that don't affect the document
				if (urlObj.hostname.includes("docs.google.com")) {
					urlObj.searchParams.delete("usp");
					urlObj.searchParams.delete("ts");
					urlObj.hash = ""; // Remove fragment
				}
				return urlObj.toString();
			} catch {
				return url;
			}
		};

		const normalizedTargetUrl = normalizeUrl(url);

		// Look for an existing tab with the same normalized URL
		const existingTab = tabs.find((tab) => {
			if (!tab.url) return false;
			const normalizedTabUrl = normalizeUrl(tab.url);
			return normalizedTabUrl === normalizedTargetUrl || tab.url === url;
		});

		if (existingTab && existingTab.id) {
			// Tab exists, switch to it
			await chrome.tabs.update(existingTab.id, { active: true });

			// Also switch to the window containing that tab
			if (existingTab.windowId) {
				await chrome.windows.update(existingTab.windowId, { focused: true });
			}

			console.log("[POPUP] Switched to existing tab:", existingTab.url);
		} else {
			// Tab doesn't exist, create a new one
			await chrome.tabs.create({ url: url });
			console.log("[POPUP] Created new tab:", url);
		}

		// Close the popup
		window.close();
	} catch (error) {
		console.error("[POPUP] Error opening/switching to tab:", error);
		// Fallback to creating new tab
		chrome.tabs.create({ url: url });
		window.close();
	}
}

(window as any).resumeTask = function (url: string) {
	openOrSwitchToTab(url);
};

(window as any).viewTasks = function () {
	// Open the history page
	chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
	window.close();
};

async function updateIdleTime(idleTime: number): Promise<void> {
	const message: ChromeMessage = {
		action: "updateIdleTime",
		idleTime,
	};

	await chrome.storage.sync.set({ idleTime });
	chrome.runtime.sendMessage(message);
}

function startStatusUpdates(): void {
	updateStatusDisplay();
}

function setupEventListeners(): void {
	const pauseBtn = document.getElementById("pauseBtn");
	if (pauseBtn) {
		pauseBtn.addEventListener("click", toggleCapture);
	}

	const settingsBtn = document.getElementById("settingsBtn");
	if (settingsBtn) {
		settingsBtn.addEventListener("click", toggleSettings);
	}

	const manualCaptureBtn = document.getElementById("manualCaptureBtn");
	if (manualCaptureBtn) {
		manualCaptureBtn.addEventListener("click", triggerManualCapture);
	}

	const historyBtn = document.getElementById("historyBtn");
	if (historyBtn) {
		historyBtn.addEventListener("click", () => {
			chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
			window.close();
		});
	}

	const idleSlider = document.getElementById("idleSlider") as HTMLInputElement;
	if (idleSlider) {
		idleSlider.addEventListener("input", (e) => {
			const value = parseInt((e.target as HTMLInputElement).value);
			const idleValue = document.getElementById("idleValue");
			if (idleValue) {
				idleValue.textContent = value + "s";
			}
			updateIdleTime(value);
		});
	}

	const retentionSelect = document.getElementById("retentionSelect");
	if (retentionSelect) {
		retentionSelect.addEventListener("change", (e) => {
			const days = parseInt((e.target as HTMLSelectElement).value);
			updateRetentionDays(days);
		});
	}

	setInterval(loadRealData, 10000);
}

async function toggleCapture(): Promise<void> {
	isTracking = !isTracking;

	await chrome.storage.sync.set({ isActive: isTracking });
	chrome.runtime.sendMessage({ action: "toggleCapture", isActive: isTracking });

	const btn = document.getElementById("pauseBtn") as HTMLElement;
	btn.textContent = isTracking ? "Pause" : "Resume";
	btn.className = isTracking ? "mini-btn primary" : "mini-btn secondary";

	updateStatusDisplay();
}

function toggleSettings(): void {
	const panel = document.getElementById("settingsPanel") as HTMLElement;
	if (panel) {
		panel.style.display = panel.style.display === "none" ? "block" : "none";
	}
}

async function updateRetentionDays(days: number): Promise<void> {
	await chrome.storage.sync.set({ retentionDays: days });
}

async function triggerManualCapture(): Promise<void> {
	console.log("[POPUP] Manual capture triggered");
	const message: ChromeMessage = {
		action: "manualCapture",
	};

	try {
		await chrome.runtime.sendMessage(message);
		console.log("[POPUP] Manual capture message sent");

		// Refresh data after a short delay
		setTimeout(() => {
			loadRealData();
		}, 2000);
	} catch (error) {
		console.error("[POPUP] Failed to trigger manual capture:", error);
	}
}

function showEmptyInsightsState(): void {
	const container = document.getElementById("aiInsights");
	if (container) {
		container.innerHTML = `
			<div class="insight-card" style="text-align: center; border: 2px dashed #e5e7eb; background: #f9fafb;">
				<div style="font-size: 48px; margin-bottom: 16px;">🧠</div>
				<div style="font-size: 16px; font-weight: 500; color: #6b7280; margin-bottom: 8px;">No AI insights available</div>
				<div style="font-size: 14px; color: #9ca3af;">Start working and Noro will analyze your activity</div>
			</div>
		`;
	}
}

async function displayRecentActivities(): Promise<void> {
	console.log(`[POPUP] ${new Date().toISOString()} - Loading recent activities from context data...`);

	// Get stored context data from recent submissions
	const storage = await chrome.storage.local.get(null);
	const contextKeys = Object.keys(storage).filter((key) => key.startsWith("context_"));

	if (contextKeys.length === 0) {
		console.log(`[POPUP] ${new Date().toISOString()} - No recent context data found`);
		return;
	}

	// Get the most recent context data
	const sortedKeys = contextKeys.sort((a, b) => {
		const timeA = parseInt(a.split("_")[1]) || 0;
		const timeB = parseInt(b.split("_")[1]) || 0;
		return timeB - timeA;
	});

	const recentContextKey = sortedKeys[0];
	const contextData = storage[recentContextKey];

	if (contextData && contextData.activities) {
		console.log(
			`[POPUP] ${new Date().toISOString()} - Found ${contextData.activities.length} activities in context data`
		);
		renderActivitiesAndInsights(contextData.activities, []);
	}
}

function renderActivitiesAndInsights(activities: Activity[], insights: AIInsight[]): void {
	console.log(
		`[POPUP] ${new Date().toISOString()} - Rendering ${activities.length} activities and ${
			insights.length
		} insights`
	);

	let container = document.getElementById("aiInsights");
	if (!container) {
		container = document.createElement("div");
		container.id = "aiInsights";
		const contentSection = document.querySelector(".content-available");
		if (contentSection?.parentNode) {
			contentSection.parentNode.insertBefore(container, contentSection.nextSibling);
		}
	}

	let html = "";

	// Render Activities Section
	if (activities.length > 0) {
		html += `
			<div class="section-header" style="margin: 16px 0 12px 0; font-weight: 600; color: #374151;">
				🎯 Current Activities
			</div>
		`;

		activities.forEach((activity, index) => {
			const isPrimary = activity.is_active || index === 0;
			html += createActivityCard(activity, isPrimary);
		});
	}

	// Render Insights Section
	if (insights.length > 0) {
		html += `
			<div class="section-header" style="margin: 16px 0 12px 0; font-weight: 600; color: #374151;">
				💡 AI Insights
			</div>
		`;

		insights.forEach((insight) => {
			html += createInsightCardHTML(insight);
		});
	}

	// Show empty state if no content
	if (activities.length === 0 && insights.length === 0) {
		showEmptyInsightsState();
		return;
	}

	container.innerHTML = html;
}

function createActivityCard(activity: Activity, isPrimary: boolean = false): string {
	const confidencePercent = Math.round(activity.confidence * 100);
	const tabCountText = activity.tab_count === 1 ? "1 tab" : `${activity.tab_count} tabs`;

	return `
		<div class="insight-card" style="border-left: 4px solid ${isPrimary ? "#10b981" : "#6b7280"}; ${
		isPrimary ? "background: #f0fdf4;" : ""
	}">
			<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
				<div class="insight-title" style="flex: 1; font-weight: 600; color: #111827;">${activity.label}</div>
				<div style="font-size: 12px; color: #6b7280; font-weight: 500;">${confidencePercent}% • ${tabCountText}</div>
			</div>
			<div class="insight-description" style="margin-bottom: 12px; color: #6b7280; font-size: 14px;">${activity.summary}</div>
			${
				activity.next_actions && activity.next_actions.length > 0
					? `
				<div style="margin-top: 12px;">
					<div style="font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 8px;">📋 Next Actions:</div>
					${activity.next_actions
						.map(
							(action: string) => `
						<div style="margin-bottom: 6px;">
							<button class="action-btn" onclick="handleActivityAction('${activity.activity_id}', '${action}')" 
								style="width: 100%; text-align: left; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px; font-size: 13px; cursor: pointer; transition: all 0.2s;">
								${action}
							</button>
						</div>
					`
						)
						.join("")}
				</div>
			`
					: ""
			}
			${
				isPrimary
					? `
				<div style="margin-top: 12px;">
					<button onclick="resumeActivity('${activity.activity_id}')" 
						style="background: #10b981; color: white; border: none; border-radius: 6px; padding: 8px 16px; font-size: 14px; font-weight: 500; cursor: pointer;">
						🚀 Resume Activity
					</button>
				</div>
			`
					: ""
			}
		</div>
	`;
}

function createInsightCardHTML(insight: AIInsight): string {
	const confidencePercent = Math.round(insight.confidence * 100);
	const priorityColor =
		insight.priority === "high" ? "#ef4444" : insight.priority === "medium" ? "#f59e0b" : "#6b7280";

	return `
		<div class="insight-card" style="border-left: 4px solid ${priorityColor};">
			<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
				<div class="insight-title" style="flex: 1; font-weight: 600; color: #111827;">${insight.title}</div>
				<div style="font-size: 12px; color: ${priorityColor}; font-weight: 500;">${insight.priority.toUpperCase()} • ${confidencePercent}%</div>
			</div>
			<div class="insight-description" style="margin-bottom: 12px; color: #6b7280; font-size: 14px;">${
				insight.description
			}</div>
			${
				insight.suggested_actions && insight.suggested_actions.length > 0
					? `
				<div style="margin-top: 12px;">
					${insight.suggested_actions
						.map(
							(action: string) => `
						<button class="action-btn" onclick="handleInsightAction('${insight.id}', '${action}')" 
							style="margin-right: 8px; margin-bottom: 6px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer;">
							${action}
						</button>
					`
						)
						.join("")}
				</div>
			`
					: ""
			}
		</div>
	`;
}

(window as any).handleActivityAction = async function (activityId: string, action: string) {
	console.log(`[POPUP] Handling activity action:`, activityId, action);
	// Implement activity action handling - could open related tabs, create tasks, etc.
};

(window as any).resumeActivity = async function (activityId: string) {
	console.log(`[POPUP] Resuming activity:`, activityId);
	// Implement activity resumption logic - switch to related tabs, restore context
};

(window as any).handleInsightAction = async function (insightId: string, action?: string) {
	try {
		console.log(`[POPUP] Handling insight action for insight: ${insightId}`);

		const awsService = AWSAPIService.getInstance();
		const insights = await awsService.getCachedInsights();
		const insight = insights.find((i) => i.id === insightId);

		if (!insight) {
			console.log(`[POPUP] Insight ${insightId} not found`);
			return;
		}

		// First try to use related URLs if available
		if (insight.related_urls && insight.related_urls.length > 0) {
			console.log(`[POPUP] Opening related URL: ${insight.related_urls[0]}`);
			openOrSwitchToTab(insight.related_urls[0]);
			return;
		}

		// If no related URLs, try to find the most recent active tab from current workspace
		if (currentWorkspace) {
			const activeTabs = currentWorkspace.windows
				.flatMap((w) => w.tabs.filter((t) => t.isActive))
				.filter((t) => t.snapshot.type !== "general");

			if (activeTabs.length > 0) {
				console.log(`[POPUP] Opening most recent active tab: ${activeTabs[0].snapshot.url}`);
				openOrSwitchToTab(activeTabs[0].snapshot.url);
				return;
			}
		}

		// Fallback: get any recent workspace from storage
		try {
			const allData = await chrome.storage.local.get(null);
			const workspaces: WorkspaceCapture[] = Object.entries(allData)
				.filter(([key]) => key.startsWith("workspace_"))
				.map(([key, value]) => ({ key, ...(value as WorkspaceCapture) }))
				.sort((a, b) => b.timestamp - a.timestamp);

			if (workspaces.length > 0) {
				const recentWorkspace = workspaces[0];
				const activeTabs = recentWorkspace.windows
					.flatMap((w) => w.tabs.filter((t) => t.isActive))
					.filter((t) => t.snapshot.type !== "general");

				if (activeTabs.length > 0) {
					console.log(`[POPUP] Opening tab from recent workspace: ${activeTabs[0].snapshot.url}`);
					openOrSwitchToTab(activeTabs[0].snapshot.url);
					return;
				}
			}
		} catch (error) {
			console.error(`[POPUP] Error accessing recent workspaces:`, error);
		}

		console.log(`[POPUP] No suitable tab found for insight ${insightId}, insight type: ${insight.insight_type}`);
	} catch (error) {
		console.error("[POPUP] Failed to handle insight action:", error);
	}
};

// New Layout Functions

function createSampleWorkspaces(): WorkspaceCapture[] {
	console.log("[POPUP] Creating sample workspaces for testing");

	const now = Date.now();
	return [
		{
			timestamp: now - 1000 * 60 * 23, // 23 minutes ago
			windows: [
				{
					windowId: 1,
					activeTabId: 1,
					tabs: [
						{
							tabId: 1,
							isActive: true,
							snapshot: {
								url: "https://mail.google.com",
								title: "Email with Mohammad",
								timestamp: now - 1000 * 60 * 23,
								type: "gmail",
								data: {},
							},
						},
					],
				},
			],
		},
		{
			timestamp: now - 1000 * 60 * 60 * 2, // 2 hours ago
			windows: [
				{
					windowId: 2,
					activeTabId: 2,
					tabs: [
						{
							tabId: 2,
							isActive: true,
							snapshot: {
								url: "https://docs.google.com/spreadsheets/d/sample",
								title: "Budget Report Q4.sheets",
								timestamp: now - 1000 * 60 * 60 * 2,
								type: "google-sheets",
								data: {
									workbook: "Budget Report Q4",
									activeSheet: "Summary",
									selectedRange: "H34",
								},
							},
						},
					],
				},
			],
		},
		{
			timestamp: now - 1000 * 60 * 60 * 4, // 4 hours ago
			windows: [
				{
					windowId: 3,
					activeTabId: 3,
					tabs: [
						{
							tabId: 3,
							isActive: true,
							snapshot: {
								url: "https://docs.google.com/document/d/sample",
								title: "Client Deck.docs",
								timestamp: now - 1000 * 60 * 60 * 4,
								type: "google-docs",
								data: {
									documentName: "Client Deck",
								},
							},
						},
					],
				},
			],
		},
		{
			timestamp: now - 1000 * 60 * 60 * 4, // 4 hours ago
			windows: [
				{
					windowId: 4,
					activeTabId: 4,
					tabs: [
						{
							tabId: 4,
							isActive: true,
							snapshot: {
								url: "https://docs.google.com/presentation/d/sample",
								title: "Client Deck.slides",
								timestamp: now - 1000 * 60 * 60 * 4,
								type: "google-slides",
								data: {
									presentationName: "Client Deck",
								},
							},
						},
					],
				},
			],
		},
		{
			timestamp: now - 1000 * 60 * 60 * 5, // 5 hours ago
			windows: [
				{
					windowId: 5,
					activeTabId: 5,
					tabs: [
						{
							tabId: 5,
							isActive: true,
							snapshot: {
								url: "https://docs.google.com/presentation/d/weekly-report",
								title: "Weekly Report",
								timestamp: now - 1000 * 60 * 60 * 5,
								type: "google-slides",
								data: {
									presentationName: "Weekly Report",
								},
							},
						},
					],
				},
			],
		},
	];
}

function displayMainTaskCard(workspace: WorkspaceCapture): void {
	console.log("[POPUP] displayMainTaskCard called");
	const mainTaskCard = document.getElementById("mainTaskCard");
	if (!mainTaskCard) {
		console.error("[POPUP] mainTaskCard element not found!");
		return;
	}
	console.log("[POPUP] mainTaskCard element found:", mainTaskCard);

	// Find the primary active task
	const activeTabs = workspace.windows
		.flatMap((w) => (w.tabs ? w.tabs.filter((t) => t.isActive && t.snapshot) : []))
		.filter((t) => t.snapshot && t.snapshot.type !== "general");

	console.log("[POPUP] Found", activeTabs.length, "active tabs in main task card");

	if (activeTabs.length === 0) {
		// Show welcome message if no active tasks
		console.log("[POPUP] No active tabs, showing welcome message");
		mainTaskCard.innerHTML = `
			<div class="welcome-back">
				<div class="welcome-title">Welcome back! 😊</div>
			</div>
		`;
		return;
	}

	const primaryTask = activeTabs[0];
	const taskInfo = getTaskInfo(primaryTask);
	const timeAgo = getTimeAgo(workspace.timestamp);

	const iconMap: Record<string, IconConfig> = {
		"google-docs": { emoji: "📄", class: "docs" },
		"google-sheets": { emoji: "📊", class: "sheets" },
		"google-slides": { emoji: "📈", class: "slides" },
		gmail: { emoji: "📧", class: "email" },
		article: { emoji: "📰", class: "docs" },
		search: { emoji: "🔍", class: "docs" },
	};

	const icon = iconMap[primaryTask.snapshot.type] || { emoji: "📄", class: "docs" };

	mainTaskCard.innerHTML = `
		<div class="main-task-card">
			<div class="main-task-welcome">Welcome back! 😊</div>
			<div class="main-task-header">
				<div class="main-task-icon ${icon.class}">${icon.emoji}</div>
				<div class="main-task-title">${taskInfo.title}</div>
			</div>
			<div class="main-task-content">
				<div class="main-task-section-label">Last action</div>
				<div class="main-task-description">${taskInfo.context}</div>
				<div class="main-task-section-label">Next step</div>
				<div class="main-task-description">${taskInfo.task}</div>
				<div class="main-task-time">
					<span>⏱️</span>
					<span>You left ${timeAgo}</span>
				</div>
			</div>
			<div class="main-task-actions">
				<button class="primary task-resume" data-url="${primaryTask.snapshot.url}">▶ Resume Task</button>
				<button class="secondary" onclick="viewTasks()">📋 View Tasks</button>
			</div>
		</div>
	`;

	// Add click handlers
	const resumeBtn = mainTaskCard.querySelector(".task-resume") as HTMLButtonElement;
	if (resumeBtn) {
		resumeBtn.addEventListener("click", () => {
			const url = resumeBtn.dataset.url;
			if (url) {
				openOrSwitchToTab(url);
			}
		});
	}
}

function displayNewRecentTasks(workspaces: WorkspaceCapture[]): void {
	console.log("[POPUP] displayNewRecentTasks called with", workspaces.length, "workspaces");
	const recentTasksList = document.querySelector(".recent-tasks-list");
	if (!recentTasksList) {
		console.error("[POPUP] recent-tasks-list element not found!");
		return;
	}

	// Collect all unique tasks from recent workspaces
	const allTasks: { tab: TabSnapshot; timestamp: number; workspace: WorkspaceCapture }[] = [];

	workspaces.forEach((workspace) => {
		if (workspace.windows) {
			workspace.windows.forEach((window) => {
				if (window.tabs) {
					window.tabs
						.filter((t) => t.snapshot && t.snapshot.type !== "general")
						.forEach((tab) => {
							allTasks.push({ tab, timestamp: workspace.timestamp, workspace });
						});
				}
			});
		}
	});

	console.log("[POPUP] Found", allTasks.length, "total tasks");

	if (allTasks.length === 0) {
		displayEmptyRecentTasks();
		return;
	}

	// Remove duplicates and sort by timestamp
	const uniqueTasks = allTasks
		.filter((task, index, arr) => arr.findIndex((t) => t.tab.snapshot?.url === task.tab.snapshot?.url) === index)
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, 5); // Limit to 5 most recent

	console.log("[POPUP] Showing", uniqueTasks.length, "unique recent tasks");

	recentTasksList.innerHTML = uniqueTasks
		.map((task) => {
			const taskInfo = getTaskInfo(task.tab);
			const timeAgo = getTimeAgo(task.timestamp);

			const iconMap: Record<string, IconConfig> = {
				"google-docs": { emoji: "📄", class: "docs" },
				"google-sheets": { emoji: "📊", class: "sheets" },
				"google-slides": { emoji: "📈", class: "slides" },
				gmail: { emoji: "📧", class: "email" },
				article: { emoji: "📰", class: "docs" },
				search: { emoji: "🔍", class: "docs" },
			};

			const icon = iconMap[task.tab.snapshot.type] || { emoji: "📄", class: "docs" };

			return `
			<div class="recent-task-item">
				<div class="recent-task-header">
					<div class="recent-task-icon ${icon.class}">${icon.emoji}</div>
					<div class="recent-task-content">
						<div class="recent-task-title-row">
							<div class="recent-task-title">${taskInfo.title}</div>
							<div class="recent-task-time">${timeAgo}</div>
						</div>
						<div class="recent-task-meta">Last: ${taskInfo.context}</div>
						<div class="recent-task-next">Next: ${taskInfo.task}</div>
						<a href="#" class="resume-task-link" onclick="openOrSwitchToTab('${task.tab.snapshot.url}')">Resume Task ></a>
					</div>
				</div>
			</div>
		`;
		})
		.join("");
}

function displayNewSuggestedTasks(workspaces: WorkspaceCapture[]): void {
	console.log("[POPUP] displayNewSuggestedTasks called");
	const suggestedContainer = document.getElementById("suggestedTasks");
	if (!suggestedContainer) {
		console.error("[POPUP] suggestedTasks element not found!");
		return;
	}

	// Create suggested sections based on workspace analysis
	const suggestions = analyzeWorkspacesForSuggestions(workspaces);
	console.log("[POPUP] Generated", suggestions.length, "suggestions");

	if (suggestions.length === 0) {
		displayEmptySuggestedTasks();
		return;
	}

	suggestedContainer.innerHTML = suggestions
		.map((suggestion) => {
			if (suggestion.type === "arrow") {
				return `
				<div class="suggested-section">
					<div class="suggested-header">
						<div class="suggested-title">Suggested for you ${suggestion.icon}</div>
					</div>
					<div class="suggested-subtitle">${suggestion.description}</div>
					<div class="suggested-item arrow-style" onclick="openOrSwitchToTab('${suggestion.url}')" style="cursor: pointer;">
						<div class="suggested-item-icon ${suggestion.itemClass}">${suggestion.itemIcon}</div>
						<div class="suggested-item-content">
							<div class="suggested-item-title">${suggestion.itemTitle}</div>
							<div class="suggested-item-meta">${suggestion.itemMeta}</div>
							<div style="font-size: 14px; color: #6b7280;">${suggestion.question}</div>
						</div>
						<div class="suggested-arrow">→</div>
					</div>
				</div>
			`;
			} else {
				return `
				<div class="suggested-section">
					<div class="suggested-header">
						<div class="suggested-title">Suggested for you ${suggestion.icon}</div>
					</div>
					<div class="suggested-subtitle">${suggestion.description}</div>
					<div class="suggested-item">
						<div class="suggested-item-header">
							<div class="suggested-item-icon ${suggestion.itemClass}">${suggestion.itemIcon}</div>
							<div class="suggested-item-content">
								<div class="suggested-item-title">${suggestion.itemTitle}</div>
								<div class="suggested-item-meta">${suggestion.itemMeta}</div>
							</div>
						</div>
						<div class="suggested-item-question">${suggestion.question}</div>
						<div class="suggested-actions">
							<button class="primary" onclick="openOrSwitchToTab('${suggestion.url}')">▶ ${suggestion.action}</button>
							<button class="secondary">Dismiss</button>
						</div>
					</div>
				</div>
			`;
			}
		})
		.join("");
}

function analyzeWorkspacesForSuggestions(workspaces: WorkspaceCapture[]): any[] {
	console.log("[POPUP] analyzeWorkspacesForSuggestions called with", workspaces.length, "workspaces");
	const suggestions: any[] = [];

	// Find patterns in workspace data to generate suggestions
	workspaces.forEach((workspace, index) => {
		if (index >= 2) return; // Limit to 2 suggestions

		if (!workspace.windows) {
			console.log("[POPUP] Workspace has no windows, skipping");
			return;
		}

		const activeTabs = workspace.windows
			.flatMap((w) => (w.tabs ? w.tabs.filter((t) => t.isActive && t.snapshot) : []))
			.filter((t) => t.snapshot && t.snapshot.type !== "general");

		console.log("[POPUP] Workspace", index, "has", activeTabs.length, "active tabs");

		if (activeTabs.length > 0) {
			const tab = activeTabs[0];
			const taskInfo = getTaskInfo(tab);
			const daysAgo = Math.floor((Date.now() - workspace.timestamp) / (1000 * 60 * 60 * 24));

			let suggestion;

			if (tab.snapshot.type === "google-slides") {
				suggestion = {
					type: index === 0 ? "button" : "arrow",
					icon: "💡",
					description: `You usually review notes after ${Math.max(daysAgo, 3)} days.`,
					itemIcon: "📈",
					itemClass: "slides",
					itemTitle: taskInfo.title,
					itemMeta: `Created ${Math.max(daysAgo, 3)} days ago`,
					question:
						index === 0
							? "Reopen for review ?"
							: `You usually review notes after ${Math.max(daysAgo, 3)} days.`,
					action: "Open",
					url: tab.snapshot.url,
				};
			} else if (tab.snapshot.type === "google-docs") {
				suggestion = {
					type: index === 0 ? "button" : "arrow",
					icon: "💡",
					description: `You usually review notes after ${Math.max(daysAgo, 3)} days.`,
					itemIcon: "📄",
					itemClass: "docs",
					itemTitle: taskInfo.title,
					itemMeta: `Created ${Math.max(daysAgo, 3)} days ago`,
					question:
						index === 0
							? "Reopen for review ?"
							: `You usually review notes after ${Math.max(daysAgo, 3)} days.`,
					action: "Open",
					url: tab.snapshot.url,
				};
			} else {
				suggestion = {
					type: index === 0 ? "button" : "arrow",
					icon: "💡",
					description: "Based on your recent activity patterns.",
					itemIcon: "📊",
					itemClass: "sheets",
					itemTitle: taskInfo.title,
					itemMeta: `Last accessed ${Math.max(daysAgo, 1)} days ago`,
					question: index === 0 ? "Continue where you left off?" : "Based on your recent activity patterns.",
					action: "Open",
					url: tab.snapshot.url,
				};
			}

			suggestions.push(suggestion);
			console.log("[POPUP] Added suggestion:", suggestion.itemTitle);
		}
	});

	console.log("[POPUP] analyzeWorkspacesForSuggestions returning", suggestions.length, "suggestions");
	return suggestions;
}

(window as any).clearRecentTasks = function () {
	console.log("[POPUP] Clearing recent tasks");
	// Implementation for clearing recent tasks
};

(window as any).openOrSwitchToTab = openOrSwitchToTab;

console.log("[POPUP] TypeScript loaded with shared types and real data integration");
