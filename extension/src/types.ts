export interface PageSnapshot<T = any> {
	url: string;
	title: string;
	timestamp: number;
	type: PageType;
	data?: T;
}

export type PageType =
	| "google-sheets"
	| "google-docs"
	| "google-slides"
	| "google-forms"
	| "gmail"
	| "article"
	| "search"
	| "general"
	| "unknown";

export interface GoogleDocsData {
	documentName: string;
	screenshot: string | null;
}

export interface GoogleSheetsData {
	workbook: string;
	activeSheet?: string;
	selectedRange?: string;
	screenshot: string | null;
}

export interface GoogleSlidesData {
	presentationName: string;
	screenshot: string | null;
}

export interface GoogleFormsData {
	formName: string;
	screenshot: string | null;
}

export interface GmailData {
	screenshot: string | null;
}

export interface ArticleData {
	scrollPositionPercent: number;
	visibleText: string;
}

export interface SearchData {
	searchQuery: string;
	searchResults: SearchResultData[];
	searchEngine: string;
}

export interface SearchResultData {
	title: string;
	url: string;
	isClicked: boolean;
}

export interface TabSnapshot {
	tabId: number;
	isActive: boolean;
	snapshot: PageSnapshot;
}

export interface WindowSnapshot {
	windowId: number;
	activeTabId: number;
	tabs: TabSnapshot[];
}

export interface WorkspaceCapture {
	timestamp: number;
	windows: WindowSnapshot[];
	key?: string;
}

// Settings interfaces
export interface UserSettings {
	isActive: boolean;
	idleTime: number;
	retentionDays: number;
	userId?: string;
}

// UI-specific interfaces
export interface TaskInfo {
	title: string;
	context: string;
	task: string;
}

export interface IconConfig {
	emoji?: string;
	iconPath?: string;
	class: string;
}

// Storage key patterns
export type StorageKey = `workspace_${number}` | `screenshot_${number}_${number}` | `img_${number}_${number}`;

// Chrome message types
export interface ChromeMessage {
	action: "processSnapshot" | "toggleCapture" | "updateIdleTime" | "getUserId" | "manualCapture" | "captureStatus";
	snapshot?: PageSnapshot;
	isActive?: boolean;
	idleTime?: number;
	userId?: string;
	status?: "capturing" | "processing" | "paused" | null;
}

// AWS API interfaces
export interface ContextSubmission {
	user_id: string;
	timestamp: number;
	windows: WindowSnapshot[];
	metadata?: {
		total_tabs: number;
		total_windows: number;
		capture_reason: "idle" | "manual";
	};
}

export interface Activity {
	activity_id: string;
	label: string;
	tab_count: number;
	is_active: boolean;
	summary: string;
	next_actions: string[];
	confidence: number;
	tab_hashes: string[];
	active_url_hash: string;
	rank: number;
}

export interface ContextResponse {
	ok: boolean;
	primary_activity_id: string;
	activities: Activity[];
}

export interface AIInsight {
	id: string;
	user_id: string;
	timestamp: number;
	workspace_id: string;
	insight_type: "task_continuation" | "context_switch" | "productivity_pattern" | "suggestion";
	title: string;
	description: string;
	confidence: number;
	suggested_actions?: string[];
	related_urls?: string[];
	priority: "low" | "medium" | "high";
}

export interface InsightsResponse {
	insights: AIInsight[];
	total_count: number;
	has_more: boolean;
}

export interface APIError {
	error: string;
	message: string;
	timestamp: number;
}

export interface HealthResponse {
	status: "healthy" | "degraded" | "unhealthy";
	timestamp: number;
	version: string;
}
