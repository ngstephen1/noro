interface PageSnapshot<T = any> {
	url: string;
	title: string;
	timestamp: number;
	type:
		| "google-sheets"
		| "google-docs"
		| "google-slides"
		| "google-forms"
		| "gmail"
		| "article"
		| "search"
		| "general"
		| "unknown";
	searchQuery?: string | null;
	data?: T;
}

function detectPageType(): { type: PageSnapshot["type"]; searchQuery?: string } {
	const url = window.location.href;
	// Google Workspace
	if (url.includes("docs.google.com/spreadsheets")) return { type: "google-sheets" };
	if (url.includes("docs.google.com/document")) return { type: "google-docs" };
	if (url.includes("docs.google.com/presentation")) return { type: "google-slides" };
	if (url.includes("docs.google.com/forms")) return { type: "google-forms" };
	if (url.includes("mail.google.com")) return { type: "gmail" };
	// Search engines
	const searchQuery = extractSearchQuery(url);
	if (searchQuery) return { type: "search", searchQuery };
	// Web articles
	if (document.querySelector("article")) return { type: "article" }; // TODO this approach may be too simple for article detection, find a better way to do this
	// General web browsing
	if (url.startsWith("http")) return { type: "general" };
	return { type: "unknown" };
}

function extractSearchQuery(url: string): string | null {
	const urlObj = new URL(url);
	if (url.includes("google.com/search") || url.includes("bing.com/search") || url.includes("duckduckgo.com"))
		return urlObj.searchParams.get("q");
	return null;
}

function captureSnapshot(): PageSnapshot {
	const detection = detectPageType();
	const snapshot: PageSnapshot = {
		url: window.location.href,
		title: document.title,
		timestamp: Date.now(),
		type: detection.type,
		searchQuery: detection.searchQuery,
		data: captureSnapshotData(detection.type),
	};
	return snapshot;
}

function captureSnapshotData(type: PageSnapshot["type"]): any {
	switch (type) {
		default:
			return null;
	}
}

}

console.log("[NORO] Content script loaded");
console.log("[NORO] Waiting 5 seconds before capturing context...");
setTimeout(() => {
	console.log("[NORO] 5 seconds elapsed, capturing context now!");
	captureSnapshot();
}, 5000);
