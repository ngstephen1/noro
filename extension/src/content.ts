interface ContextData {
    url: string;
    title: string;
    timestamp: number;
    type: 'google-sheets' | 'google-docs' | 'google-slides' | 'google-forms' | 'gmail' | 'article' | 'search' | 'general' | 'unknown';
    searchQuery?: string;
}

function detectPageType(): { type: ContextData['type'], searchQuery?: string} {
    const url = window.location.href;
    // Google Workspace
    if (url.includes('docs.google.com/spreadsheets')) return { type: 'google-sheets'};
    if (url.includes('docs.google.com/document')) return { type: 'google-docs'};
    if (url.includes('docs.google.com/presentation')) return { type: 'google-slides'};
    if (url.includes('docs.google.com/forms')) return { type: 'google-forms'};
    if (url.includes('mail.google.com')) return { type: 'gmail'};
    // Search engines
    const searchQuery = extractSearchQuery(url);
    if (searchQuery) return { type: 'search', searchQuery}
    // Web articles
    if (document.querySelector('article')) return { type: 'article'}; // TODO this approach may be too simple for article detection, find a better way to do this
    // General web browsing
    if (url.startsWith('http')) return { type: 'general'};
    return {type: 'unknown'};
}

function extractSearchQuery(url: string): string | null {
    const urlObj = new URL(url);
    if(url.includes("google.com/search") || url.includes("bing.com/search") || url.includes("duckduckgo.com")) return urlObj.searchParams.get('q');
    return null;
}
}