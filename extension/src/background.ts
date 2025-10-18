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
	data?: T;
}

interface GoogleDocsData {
	documentName: string;
	screenshot: string | null;
}

interface GoogleSheetsData {
	workbook: string;
	activeSheet?: string;
	selectedRange?: string;
	screenshot: string | null;
}

interface GoogleSlidesData {
	presentationName: string;
	screenshot: string | null;
}

interface GoogleFormsData {
	formName: string;
	screenshot: string | null;
}

interface GmailData {
	screenshot: string | null;
}

interface ArticleData {
	scrollPositionPercent: number;
	visibleText: string;
}

interface SearchData {
	searchQuery: string;
	searchResults: SearchResultData[];
	searchEngine: string;
}

interface SearchResultData {
	title: string;
	url: string;
	isClicked: boolean;
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
