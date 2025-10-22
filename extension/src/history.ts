import { WorkspaceCapture, WindowSnapshot, TabSnapshot, PageSnapshot, IconConfig } from "./types.js";

// State management
let allWorkspaces: WorkspaceCapture[] = [];
let filteredWorkspaces: WorkspaceCapture[] = [];
let searchQuery = "";

document.addEventListener("DOMContentLoaded", async () => {
	await loadWorkspaceHistory();
	setupEventListeners();
});

async function loadWorkspaceHistory(): Promise<void> {
	try {
		const allData = await chrome.storage.local.get(null);

		// Extract workspaces
		allWorkspaces = Object.entries(allData)
			.filter(([key]) => key.startsWith("workspace_"))
			.map(([key, value]) => ({ key, ...(value as WorkspaceCapture) }))
			.sort((a, b) => b.timestamp - a.timestamp);

		filteredWorkspaces = [...allWorkspaces];

		console.log("[HISTORY] Loaded", allWorkspaces.length, "workspaces");

		updateStats();
		displayWorkspaces();
	} catch (error) {
		console.error("[HISTORY] Failed to load workspace history:", error);
		showEmptyState();
	}
}

function updateStats(): void {
	const totalWorkspaces = allWorkspaces.length;
	const totalTabs = allWorkspaces.reduce(
		(sum, ws) => sum + ws.windows.reduce((winSum, win) => winSum + win.tabs.length, 0),
		0
	);

	const oldestTimestamp =
		allWorkspaces.length > 0 ? Math.min(...allWorkspaces.map((ws) => ws.timestamp)) : Date.now();
	const totalDays = Math.max(1, Math.ceil((Date.now() - oldestTimestamp) / (1000 * 60 * 60 * 24)));

	// Estimate storage usage (rough calculation)
	const storageUsed = Math.round((JSON.stringify(allWorkspaces).length / (1024 * 1024)) * 100) / 100;

	document.getElementById("totalWorkspaces")!.textContent = totalWorkspaces.toString();
	document.getElementById("totalTabs")!.textContent = totalTabs.toString();
	document.getElementById("totalDays")!.textContent = totalDays.toString();
	document.getElementById("storageUsed")!.textContent = `${storageUsed} MB`;
}

function displayWorkspaces(): void {
	const loadingState = document.getElementById("loadingState")!;
	const workspaceGrid = document.getElementById("workspaceGrid")!;
	const emptyState = document.getElementById("emptyState")!;

	loadingState.style.display = "none";

	if (filteredWorkspaces.length === 0) {
		workspaceGrid.style.display = "none";
		emptyState.style.display = "block";
		return;
	}

	emptyState.style.display = "none";
	workspaceGrid.style.display = "grid";

	workspaceGrid.innerHTML = "";

	filteredWorkspaces.forEach((workspace) => {
		const card = createWorkspaceCard(workspace);
		workspaceGrid.appendChild(card);
	});
}

function createWorkspaceCard(workspace: WorkspaceCapture): HTMLElement {
	const card = document.createElement("div");
	card.className = "workspace-card";

	const timeStr = new Date(workspace.timestamp).toLocaleString();
	const totalTabs = workspace.windows.reduce((sum, win) => sum + win.tabs.length, 0);
	const activeTab = workspace.windows.flatMap((win) => win.tabs).find((tab) => tab.isActive);

	// Get the most interesting tab for summary
	const summaryTab =
		activeTab ||
		workspace.windows.flatMap((win) => win.tabs).find((tab) => tab.snapshot.type !== "general") ||
		workspace.windows[0]?.tabs[0];

	const summary = summaryTab ? getWorkspaceSummary(summaryTab) : "General browsing session";

	card.innerHTML = `
        <div class="workspace-header">
            <div class="workspace-time">${timeStr}</div>
            <div class="workspace-summary">${summary}</div>
            <div class="workspace-stats">
                <span>🪟 ${workspace.windows.length} windows</span>
                <span>📑 ${totalTabs} tabs</span>
            </div>
        </div>
        
        ${
			activeTab?.snapshot.data?.screenshot
				? `
            <div class="screenshot-container">
                <img class="screenshot" src="" data-screenshot="${
					activeTab.snapshot.data.screenshot
				}" alt="Workspace screenshot">
                <div class="screenshot-overlay">
                    <div style="font-size: 14px; font-weight: 500;">${getTaskInfo(activeTab).title}</div>
                </div>
            </div>
        `
				: ""
		}
        
        <div class="tab-list">
            ${workspace.windows
				.flatMap((win) => win.tabs.slice(0, 3))
				.map((tab) => createTabListItem(tab))
				.join("")}
            ${
				totalTabs > 3
					? `<div class="tab-item" style="color: #6b7280; font-style: italic;">+ ${
							totalTabs - 3
					  } more tabs</div>`
					: ""
			}
        </div>
        
        <div class="workspace-actions">
            <button class="action-btn primary" data-workspace-key="${workspace.key}">
                📋 View Details
            </button>
            <button class="action-btn danger" data-workspace-key="${workspace.key}">
                🗑️ Delete
            </button>
        </div>
    `;

	// Load screenshot if available
	const screenshot = card.querySelector(".screenshot") as HTMLImageElement;
	if (screenshot && activeTab?.snapshot.data?.screenshot) {
		loadScreenshot(activeTab.snapshot.data.screenshot, screenshot);
	}

	// Add event listeners
	const viewBtn = card.querySelector(".action-btn.primary") as HTMLButtonElement;
	const deleteBtn = card.querySelector(".action-btn.danger") as HTMLButtonElement;

	viewBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		showWorkspaceDetails(workspace);
	});

	deleteBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		deleteWorkspace(workspace);
	});

	// Make card clickable to show details
	card.addEventListener("click", () => {
		showWorkspaceDetails(workspace);
	});

	return card;
}

async function loadScreenshot(screenshotKey: string, imgElement: HTMLImageElement): Promise<void> {
	try {
		const result = await chrome.storage.local.get([screenshotKey]);
		if (result[screenshotKey]) {
			imgElement.src = result[screenshotKey];
		}
	} catch (error) {
		console.error("[HISTORY] Failed to load screenshot:", error);
	}
}

function createTabListItem(tab: TabSnapshot): string {
	const taskInfo = getTaskInfo(tab);
	const iconMap: Record<string, IconConfig> = {
		"google-docs": { emoji: "📄", class: "docs" },
		"google-sheets": { emoji: "📊", class: "sheets" },
		"google-slides": { emoji: "📊", class: "slides" },
		gmail: { emoji: "📧", class: "email" },
		article: { emoji: "📰", class: "docs" },
		search: { emoji: "🔍", class: "docs" },
	};

	const icon = iconMap[tab.snapshot.type] || { emoji: "🌐", class: "docs" };

	return `
        <div class="tab-item">
            <div class="tab-icon ${icon.class}">${icon.emoji}</div>
            <div class="tab-title">${taskInfo.title}</div>
            <div class="tab-time">${tab.isActive ? "Active" : ""}</div>
        </div>
    `;
}

function getWorkspaceSummary(tab: TabSnapshot): string {
	const taskInfo = getTaskInfo(tab);
	return `${taskInfo.context} - ${taskInfo.title}`;
}

function getTaskInfo(tab: TabSnapshot): { title: string; context: string; task: string } {
	const data = tab.snapshot.data;
	const type = tab.snapshot.type;

	switch (type) {
		case "google-docs":
			return {
				title: data?.documentName || "Unknown Document",
				context: "Editing document",
				task: "Continue writing",
			};
		case "google-sheets":
			return {
				title: data?.workbook || "Unknown Workbook",
				context: `Working on ${data?.activeSheet || "sheet"}`,
				task: "Continue analysis",
			};
		case "google-slides":
			return {
				title: data?.presentationName || "Unknown Presentation",
				context: "Editing presentation",
				task: "Continue editing",
			};
		case "gmail":
			return {
				title: "Email",
				context: "Managing emails",
				task: "Check inbox",
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
				title: tab.snapshot.title.slice(0, 50) || "Unknown Page",
				context: "Browsing",
				task: "Continue",
			};
	}
}

function showWorkspaceDetails(workspace: WorkspaceCapture): void {
	const modal = document.getElementById("workspaceModal")!;
	const modalContent = document.getElementById("modalContent")!;

	const timeStr = new Date(workspace.timestamp).toLocaleString();
	const totalTabs = workspace.windows.reduce((sum, win) => sum + win.tabs.length, 0);

	modalContent.innerHTML = `
        <h2 style="margin-bottom: 20px;">Workspace Details</h2>
        <p style="color: #6b7280; margin-bottom: 20px;">Captured on ${timeStr}</p>
        
        <div style="margin-bottom: 30px;">
            <h3 style="margin-bottom: 15px;">Summary</h3>
            <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
                <div>🪟 <strong>${workspace.windows.length}</strong> windows open</div>
                <div>📑 <strong>${totalTabs}</strong> total tabs</div>
                <div>⏰ Captured at <strong>${timeStr}</strong></div>
            </div>
        </div>
        
        ${workspace.windows
			.map(
				(window, windowIndex) => `
            <div style="margin-bottom: 25px;">
                <h3 style="margin-bottom: 15px;">Window ${windowIndex + 1} (${window.tabs.length} tabs)</h3>
                <div style="display: grid; gap: 10px;">
                    ${window.tabs
						.map(
							(tab) => `
                        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px; cursor: pointer;" 
                             onclick="openOrSwitchToTab('${tab.snapshot.url}')">
                            <div style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 4px; background: #e5e7eb;">
                                ${getTabIcon(tab.snapshot.type)}
                            </div>
                            <div style="flex: 1;">
                                <div style="font-weight: 500; color: #374151;">${getTaskInfo(tab).title}</div>
                                <div style="font-size: 14px; color: #6b7280;">${tab.snapshot.url}</div>
                            </div>
                            <div style="font-size: 12px; color: #9ca3af;">
                                ${
									tab.isActive
										? '<span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px;">Active</span>'
										: ""
								}
                            </div>
                        </div>
                    `
						)
						.join("")}
                </div>
            </div>
        `
			)
			.join("")}
    `;

	modal.style.display = "block";
}

function getTabIcon(type: string): string {
	const iconMap: Record<string, string> = {
		"google-docs": "📄",
		"google-sheets": "📊",
		"google-slides": "📊",
		gmail: "📧",
		article: "📰",
		search: "🔍",
	};
	return iconMap[type] || "🌐";
}

async function deleteWorkspace(workspace: WorkspaceCapture): Promise<void> {
	if (!confirm("Are you sure you want to delete this workspace capture? This action cannot be undone.")) {
		return;
	}

	try {
		// Delete the workspace and associated screenshots
		const keysToDelete: string[] = [];
		if (workspace.key) {
			keysToDelete.push(workspace.key);
		}

		// Find and delete associated screenshots
		workspace.windows.forEach((window) => {
			window.tabs.forEach((tab) => {
				if (tab.snapshot.data?.screenshot) {
					keysToDelete.push(tab.snapshot.data.screenshot);
				}
			});
		});

		await chrome.storage.local.remove(keysToDelete);

		// Update local state
		allWorkspaces = allWorkspaces.filter((ws) => ws.key !== workspace.key);
		filteredWorkspaces = filteredWorkspaces.filter((ws) => ws.key !== workspace.key);

		updateStats();
		displayWorkspaces();

		console.log("[HISTORY] Deleted workspace:", workspace.key);
	} catch (error) {
		console.error("[HISTORY] Failed to delete workspace:", error);
		alert("Failed to delete workspace. Please try again.");
	}
}

async function clearAllWorkspaces(): Promise<void> {
	if (!confirm("Are you sure you want to delete ALL workspace history? This action cannot be undone.")) {
		return;
	}

	if (
		!confirm("This will permanently delete all your captured workspaces and screenshots. Are you absolutely sure?")
	) {
		return;
	}

	try {
		// Get all keys that need to be deleted
		const allData = await chrome.storage.local.get(null);
		const keysToDelete = Object.keys(allData).filter(
			(key) => key.startsWith("workspace_") || key.startsWith("img_")
		);

		await chrome.storage.local.remove(keysToDelete);

		// Reset state
		allWorkspaces = [];
		filteredWorkspaces = [];

		updateStats();
		displayWorkspaces();

		console.log("[HISTORY] Cleared all workspace history");
	} catch (error) {
		console.error("[HISTORY] Failed to clear all workspaces:", error);
		alert("Failed to clear workspace history. Please try again.");
	}
}

function searchWorkspaces(query: string): void {
	searchQuery = query.toLowerCase();

	if (!searchQuery) {
		filteredWorkspaces = [...allWorkspaces];
	} else {
		filteredWorkspaces = allWorkspaces.filter((workspace) => {
			// Search in workspace summary
			const hasActiveTabs = workspace.windows.some((window) =>
				window.tabs.some((tab) => {
					const taskInfo = getTaskInfo(tab);
					return (
						taskInfo.title.toLowerCase().includes(searchQuery) ||
						taskInfo.context.toLowerCase().includes(searchQuery) ||
						tab.snapshot.url.toLowerCase().includes(searchQuery) ||
						tab.snapshot.title.toLowerCase().includes(searchQuery)
					);
				})
			);

			return hasActiveTabs;
		});
	}

	displayWorkspaces();
}

function showEmptyState(): void {
	const loadingState = document.getElementById("loadingState")!;
	const workspaceGrid = document.getElementById("workspaceGrid")!;
	const emptyState = document.getElementById("emptyState")!;

	loadingState.style.display = "none";
	workspaceGrid.style.display = "none";
	emptyState.style.display = "block";
}

async function openOrSwitchToTab(url: string): Promise<void> {
	try {
		// Query all tabs to find if the URL is already open
		const tabs = await chrome.tabs.query({});

		// Function to normalize URLs for comparison
		const normalizeUrl = (url: string): string => {
			try {
				const urlObj = new URL(url);
				if (urlObj.hostname.includes("docs.google.com")) {
					urlObj.searchParams.delete("usp");
					urlObj.searchParams.delete("ts");
					urlObj.hash = "";
				}
				return urlObj.toString();
			} catch {
				return url;
			}
		};

		const normalizedTargetUrl = normalizeUrl(url);
		const existingTab = tabs.find((tab) => {
			if (!tab.url) return false;
			const normalizedTabUrl = normalizeUrl(tab.url);
			return normalizedTabUrl === normalizedTargetUrl || tab.url === url;
		});

		if (existingTab && existingTab.id) {
			await chrome.tabs.update(existingTab.id, { active: true });
			if (existingTab.windowId) {
				await chrome.windows.update(existingTab.windowId, { focused: true });
			}
		} else {
			await chrome.tabs.create({ url: url });
		}

		// Close the history page
		window.close();
	} catch (error) {
		console.error("[HISTORY] Error opening/switching to tab:", error);
		chrome.tabs.create({ url: url });
		window.close();
	}
}

function goBackToDashboard(): void {
	// Close the current history tab and the user can use the popup
	window.close();
}

function setupEventListeners(): void {
	// Search functionality
	const searchInput = document.getElementById("searchInput") as HTMLInputElement;
	searchInput.addEventListener("input", (e) => {
		const query = (e.target as HTMLInputElement).value;
		searchWorkspaces(query);
	});

	// Clear all button
	const clearAllBtn = document.getElementById("clearAllBtn") as HTMLButtonElement;
	clearAllBtn.addEventListener("click", clearAllWorkspaces);

	// Back to dashboard buttons
	const backToDashboard = document.getElementById("backToDashboard") as HTMLButtonElement;
	const emptyStateDashboard = document.getElementById("emptyStateDashboard") as HTMLButtonElement;

	if (backToDashboard) {
		backToDashboard.addEventListener("click", goBackToDashboard);
	}

	if (emptyStateDashboard) {
		emptyStateDashboard.addEventListener("click", goBackToDashboard);
	}

	// Modal close functionality
	const closeModal = document.getElementById("closeModal") as HTMLElement;
	const modal = document.getElementById("workspaceModal") as HTMLElement;

	closeModal.addEventListener("click", () => {
		modal.style.display = "none";
	});

	window.addEventListener("click", (e) => {
		if (e.target === modal) {
			modal.style.display = "none";
		}
	});
}

// Make openOrSwitchToTab available globally for modal use
(window as any).openOrSwitchToTab = openOrSwitchToTab;

console.log("[HISTORY] History page loaded");
