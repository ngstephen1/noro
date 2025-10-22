import { ContextSubmission, AIInsight, InsightsResponse, APIError, HealthResponse, WorkspaceCapture } from "./types.js";

// AWS API Configuration
const API_BASE_URL = "https://sb21puxxcd.execute-api.us-east-1.amazonaws.com/prod";
const API_KEY = "imcyLnEytbFl6gPXsQPYKQEL1gMSY15AV0hOsmeA";
const API_ENDPOINTS = {
	context: `${API_BASE_URL}/context`,
	insights: `${API_BASE_URL}/insights`,
	health: `${API_BASE_URL}/health`,
};

// Rate limiting configuration
const RATE_LIMITS = {
	MAX_REQUESTS_PER_MINUTE: 5,
	MAX_REQUESTS_PER_HOUR: 20,
	MIN_INTERVAL_MS: 12000, // 12 seconds between requests (5 per minute)
};

class AWSAPIService {
	private static instance: AWSAPIService;

	private constructor() {}

	static getInstance(): AWSAPIService {
		if (!AWSAPIService.instance) {
			console.log(`[AWS] ${new Date().toISOString()} - 🏗️ Creating new AWSAPIService instance`);
			console.log(`[AWS] ${new Date().toISOString()} - API Configuration:`, {
				baseUrl: API_BASE_URL,
				endpoints: API_ENDPOINTS,
				rateLimits: RATE_LIMITS,
			});
			AWSAPIService.instance = new AWSAPIService();
		} else {
			console.log(`[AWS] ${new Date().toISOString()} - 🔄 Returning existing AWSAPIService instance`);
		}
		return AWSAPIService.instance;
	}

	/**
	 * Submit workspace context to AWS for AI analysis
	 */
	async submitContext(
		workspace: WorkspaceCapture,
		userId: string,
		captureReason: "idle" | "manual" = "idle"
	): Promise<string | null> {
		const functionStart = new Date().toISOString();
		console.log(`[AWS] ${functionStart} - 🔄 ENTERING submitContext() function`);
		console.log(`[AWS] ${functionStart} - Parameters:`, {
			userId: userId.slice(0, 8) + "...",
			captureReason,
			windowCount: workspace.windows.length,
			tabCount: workspace.windows.reduce((sum, w) => sum + w.tabs.length, 0),
		});

		try {
			// Check rate limits first
			console.log(`[AWS] ${new Date().toISOString()} - Checking rate limits...`);
			const shouldSubmit = await this.shouldSubmitContext();
			console.log(`[AWS] ${new Date().toISOString()} - Rate limit check complete. Result:`, shouldSubmit);

			if (!shouldSubmit) {
				console.log(
					`[AWS] ${new Date().toISOString()} - ❌ EARLY RETURN: Rate limit exceeded, skipping submission`
				);
				return null;
			}
			console.log(`[AWS] ${new Date().toISOString()} - ✅ Rate limits passed, continuing with submission`);

			// Generate correlation ID for tracking
			const correlationId = `c-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

			// Convert to API expected format
			const contextData = {
				correlation_id: correlationId,
				user_id: userId,
				ts: new Date(workspace.timestamp).toISOString(),
				event: captureReason === "manual" ? "manual_capture" : "idle_capture",
				active_app: "chrome",
				active_url_hash: this.generateUrlHash(workspace),
				tabs: workspace.windows.flatMap((window) =>
					window.tabs.map((tab) => ({
						title: tab.snapshot.title,
						url: tab.snapshot.url,
						url_hash: this.hashUrl(tab.snapshot.url),
						text_sample: this.extractTextSample(tab.snapshot),
					}))
				),
				screenshots: [], // Screenshots will be added if available
				signals: {
					idle_sec: captureReason === "idle" ? 15 : 0,
				},
				privacy: {
					redacted: true,
				},
			};

			// Log complete request details
			const requestHeaders = {
				"Content-Type": "application/json",
				"x-api-key": API_KEY,
			};

			console.log(`[AWS] ${new Date().toISOString()} - POST /context REQUEST:`);
			console.log(`[AWS] ${new Date().toISOString()} - URL:`, API_ENDPOINTS.context);
			console.log(`[AWS] ${new Date().toISOString()} - Headers:`, JSON.stringify(requestHeaders, null, 2));
			console.log(`[AWS] ${new Date().toISOString()} - Body:`, JSON.stringify(contextData, null, 2));
			console.log(`[AWS] ${new Date().toISOString()} - Correlation ID:`, correlationId);

			const response = await fetch(API_ENDPOINTS.context, {
				method: "POST",
				headers: requestHeaders,
				body: JSON.stringify(contextData),
			});

			// Log response details
			console.log(`[AWS] ${new Date().toISOString()} - POST /context RESPONSE:`);
			console.log(`[AWS] ${new Date().toISOString()} - Status:`, response.status, response.statusText);
			console.log(
				`[AWS] ${new Date().toISOString()} - Response Headers:`,
				JSON.stringify([...response.headers.entries()], null, 2)
			);

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`[AWS] ${new Date().toISOString()} - POST /context FAILED:`, response.status, errorText);
				console.error(`[AWS] ${new Date().toISOString()} - Error Response Body:`, errorText);
				throw new Error(`API Error ${response.status}: ${response.statusText}`);
			}

			const result = await response.json();
			console.log(`[AWS] ${new Date().toISOString()} - POST /context SUCCESS:`);
			console.log(`[AWS] ${new Date().toISOString()} - Response Body:`, JSON.stringify(result, null, 2));

			// Update rate limiting counters
			await this.updateRateLimitCounters();

			console.log(
				`[AWS] ${new Date().toISOString()} - 🔄 EXITING submitContext() with correlationId:`,
				correlationId
			);
			return correlationId;
		} catch (error) {
			console.error(`[AWS] ${new Date().toISOString()} - ❌ EXCEPTION in submitContext():`, error);
			console.error(
				`[AWS] ${new Date().toISOString()} - Error stack:`,
				error instanceof Error ? error.stack : "No stack trace"
			);

			// Store failed submission for retry later
			await this.storeFailedSubmission(workspace, userId, captureReason);

			console.log(`[AWS] ${new Date().toISOString()} - 🔄 EXITING submitContext() with null (error)`);
			return null;
		}
	}

	/**
	 * Get analyzed context for a specific correlation ID
	 */
	async getAnalyzedContext(correlationId: string): Promise<any | null> {
		const functionStart = new Date().toISOString();
		console.log(`[AWS] ${functionStart} - 🔄 ENTERING getAnalyzedContext() function`);
		console.log(`[AWS] ${functionStart} - Parameters:`, { correlationId });

		try {
			const url = `${API_ENDPOINTS.context}?correlation_id=${encodeURIComponent(correlationId)}`;

			// Log complete GET request details
			const requestHeaders = {
				"x-api-key": API_KEY,
			};

			console.log(`[AWS] ${new Date().toISOString()} - GET /context REQUEST:`);
			console.log(`[AWS] ${new Date().toISOString()} - URL:`, url);
			console.log(`[AWS] ${new Date().toISOString()} - Headers:`, JSON.stringify(requestHeaders, null, 2));
			console.log(`[AWS] ${new Date().toISOString()} - Query Param correlation_id:`, correlationId);

			const response = await fetch(url, {
				method: "GET",
				headers: requestHeaders,
			});

			// Log response details
			console.log(`[AWS] ${new Date().toISOString()} - GET /context RESPONSE:`);
			console.log(`[AWS] ${new Date().toISOString()} - Status:`, response.status, response.statusText);
			console.log(
				`[AWS] ${new Date().toISOString()} - Response Headers:`,
				JSON.stringify([...response.headers.entries()], null, 2)
			);

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`[AWS] ${new Date().toISOString()} - GET /context FAILED:`, response.status, errorText);
				console.error(`[AWS] ${new Date().toISOString()} - Error Response Body:`, errorText);
				if (response.status === 404) {
					console.log(
						`[AWS] ${new Date().toISOString()} - Context not yet processed for correlation ID:`,
						correlationId
					);
					return null;
				}
				throw new Error(`API Error ${response.status}: ${response.statusText}`);
			}

			const result = await response.json();
			console.log(`[AWS] ${new Date().toISOString()} - GET /context SUCCESS:`);
			console.log(`[AWS] ${new Date().toISOString()} - Response Body:`, JSON.stringify(result, null, 2));

			console.log(`[AWS] ${new Date().toISOString()} - 🔄 EXITING getAnalyzedContext() with result`);
			return result;
		} catch (error) {
			console.error(`[AWS] ${new Date().toISOString()} - ❌ EXCEPTION in getAnalyzedContext():`, error);
			console.log(`[AWS] ${new Date().toISOString()} - 🔄 EXITING getAnalyzedContext() with null (error)`);
			return null;
		}
	}

	/**
	 * Get AI insights for a user
	 */
	async getInsights(userId: string, limit: number = 5): Promise<AIInsight[]> {
		const functionStart = new Date().toISOString();
		console.log(`[AWS] ${functionStart} - 🔄 ENTERING getInsights() function`);
		console.log(`[AWS] ${functionStart} - Parameters:`, { userId: userId.slice(0, 8) + "...", limit });

		try {
			const url = `${API_ENDPOINTS.insights}?user_id=${encodeURIComponent(userId)}&limit=${limit}`;

			// Log complete GET insights request details
			const requestHeaders = {
				"x-api-key": API_KEY,
			};

			console.log(`[AWS] ${new Date().toISOString()} - GET /insights REQUEST:`);
			console.log(`[AWS] ${new Date().toISOString()} - URL:`, url);
			console.log(`[AWS] ${new Date().toISOString()} - Headers:`, JSON.stringify(requestHeaders, null, 2));
			console.log(`[AWS] ${new Date().toISOString()} - Query Params:`, { user_id: userId, limit: limit });

			const response = await fetch(url, {
				method: "GET",
				headers: requestHeaders,
			});

			// Log response details
			console.log(`[AWS] ${new Date().toISOString()} - GET /insights RESPONSE:`);
			console.log(`[AWS] ${new Date().toISOString()} - Status:`, response.status, response.statusText);
			console.log(
				`[AWS] ${new Date().toISOString()} - Response Headers:`,
				JSON.stringify([...response.headers.entries()], null, 2)
			);

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`[AWS] ${new Date().toISOString()} - GET /insights FAILED:`, response.status, errorText);
				console.error(`[AWS] ${new Date().toISOString()} - Error Response Body:`, errorText);
				throw new Error(`API Error ${response.status}: ${response.statusText}`);
			}

			const result = await response.json();
			console.log(`[AWS] ${new Date().toISOString()} - GET /insights SUCCESS:`);
			console.log(`[AWS] ${new Date().toISOString()} - Raw insights response:`, JSON.stringify(result, null, 2));

			// Convert API response format to expected format
			const insights: AIInsight[] = await Promise.all(
				result.items?.map(async (item: any, index: number) => {
					const relatedUrls = await this.extractRelatedUrls(item.correlation_id);
					const insight = {
						id: item.correlation_id || `insight-${Date.now()}-${index}`,
						user_id: userId,
						timestamp: new Date(item.ts).getTime(),
						workspace_id: item.correlation_id || "",
						insight_type: "task_continuation" as const,
						title: this.extractTitleFromSummary(item.summary),
						description: item.summary,
						confidence: item.confidence || 0.7,
						suggested_actions: item.next_actions?.map((action: any) => action.label) || [],
						related_urls: relatedUrls,
						priority: this.determinePriority(item.confidence || 0.7),
					};
					console.log(`[AWS] ${new Date().toISOString()} - Processed insight ${index + 1}:`, insight);
					return insight;
				}) || []
			);

			console.log(`[AWS] ${new Date().toISOString()} - Successfully processed ${insights.length} insights`);

			// Cache insights locally
			await chrome.storage.local.set({
				cached_insights: insights,
				insights_cached_at: Date.now(),
			});

			return insights;
		} catch (error) {
			console.error("[AWS] Failed to fetch insights:", error);

			// Return cached insights if available
			const cached = await chrome.storage.local.get(["cached_insights", "insights_cached_at"]);
			if (cached.cached_insights && Date.now() - cached.insights_cached_at < 3600000) {
				// 1 hour cache
				console.log("[AWS] Returning cached insights");
				return cached.cached_insights;
			}

			return [];
		}
	}

	/**
	 * Check API health status
	 */
	async checkHealth(): Promise<HealthResponse | null> {
		const functionStart = new Date().toISOString();
		console.log(`[AWS] ${functionStart} - 🔄 ENTERING checkHealth() function`);

		try {
			// Log complete health check request details
			const requestHeaders = {
				"x-api-key": API_KEY,
			};

			console.log(`[AWS] ${new Date().toISOString()} - GET /health REQUEST:`);
			console.log(`[AWS] ${new Date().toISOString()} - URL:`, API_ENDPOINTS.health);
			console.log(`[AWS] ${new Date().toISOString()} - Headers:`, JSON.stringify(requestHeaders, null, 2));

			const response = await fetch(API_ENDPOINTS.health, {
				method: "GET",
				headers: requestHeaders,
			});

			// Log response details
			console.log(`[AWS] ${new Date().toISOString()} - GET /health RESPONSE:`);
			console.log(`[AWS] ${new Date().toISOString()} - Status:`, response.status, response.statusText);
			console.log(
				`[AWS] ${new Date().toISOString()} - Response Headers:`,
				JSON.stringify([...response.headers.entries()], null, 2)
			);

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`[AWS] ${new Date().toISOString()} - GET /health FAILED:`, response.status, errorText);
				console.error(`[AWS] ${new Date().toISOString()} - Error Response Body:`, errorText);
				throw new Error(`Health check failed: ${response.statusText}`);
			}

			const result = await response.json();
			console.log(`[AWS] ${new Date().toISOString()} - GET /health SUCCESS:`);
			console.log(`[AWS] ${new Date().toISOString()} - Health response:`, JSON.stringify(result, null, 2));

			return {
				status: result.ok ? "healthy" : "unhealthy",
				timestamp: Date.now(),
				version: "1.0",
			};
		} catch (error) {
			console.error(`[AWS] ${new Date().toISOString()} - ❌ EXCEPTION in checkHealth():`, error);
			console.log(`[AWS] ${new Date().toISOString()} - 🔄 EXITING checkHealth() with null (error)`);
			return null;
		}
	}

	/**
	 * Retry failed submissions
	 */
	async retryFailedSubmissions(): Promise<void> {
		try {
			const data = await chrome.storage.local.get(["failed_submissions"]);
			const failedSubmissions = data.failed_submissions || [];

			if (failedSubmissions.length === 0) {
				return;
			}

			console.log("[AWS] Retrying", failedSubmissions.length, "failed submissions");

			const successfulRetries: string[] = [];

			for (const submission of failedSubmissions) {
				try {
					const contextId = await this.submitContext(
						submission.workspace,
						submission.userId,
						submission.captureReason
					);

					if (contextId) {
						successfulRetries.push(submission.id);
						console.log(
							`[AWS] ${new Date().toISOString()} - Successfully retried submission ${
								submission.id
							} with context ID: ${contextId}`
						);
					}
				} catch (error) {
					console.error(
						`[AWS] ${new Date().toISOString()} - Retry failed for submission:`,
						submission.id,
						error
					);
				}
			}

			// Remove successful retries from failed submissions
			const remainingFailed = failedSubmissions.filter(
				(submission: any) => !successfulRetries.includes(submission.id)
			);

			await chrome.storage.local.set({
				failed_submissions: remainingFailed,
			});

			if (successfulRetries.length > 0) {
				console.log("[AWS] Successfully retried", successfulRetries.length, "submissions");
			}
		} catch (error) {
			console.error("[AWS] Failed to retry submissions:", error);
		}
	}

	/**
	 * Store failed submission for later retry
	 */
	private async storeFailedSubmission(
		workspace: WorkspaceCapture,
		userId: string,
		captureReason: "idle" | "manual"
	): Promise<void> {
		try {
			const data = await chrome.storage.local.get(["failed_submissions"]);
			const failedSubmissions = data.failed_submissions || [];

			failedSubmissions.push({
				id: `failed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				workspace,
				userId,
				captureReason,
				timestamp: Date.now(),
				retryCount: 0,
			});

			// Keep only last 10 failed submissions to prevent storage overflow
			const recentFailed = failedSubmissions.slice(-10);

			await chrome.storage.local.set({
				failed_submissions: recentFailed,
			});
		} catch (error) {
			console.error("[AWS] Failed to store failed submission:", error);
		}
	}

	/**
	 * Check if we should submit context (rate limiting)
	 */
	async shouldSubmitContext(): Promise<boolean> {
		const functionStart = new Date().toISOString();
		console.log(`[AWS] ${functionStart} - 🔄 ENTERING shouldSubmitContext() function`);

		try {
			const now = Date.now();
			console.log(`[AWS] ${new Date().toISOString()} - Current timestamp:`, now);

			const data = await chrome.storage.local.get([
				"last_aws_submission",
				"aws_requests_minute",
				"aws_requests_hour",
				"aws_minute_start",
				"aws_hour_start",
			]);

			console.log(`[AWS] ${new Date().toISOString()} - Rate limit storage data:`, JSON.stringify(data, null, 2));

			const lastSubmission = data.last_aws_submission || 0;
			const minuteStart = data.aws_minute_start || now;
			const hourStart = data.aws_hour_start || now;

			console.log(`[AWS] ${new Date().toISOString()} - Rate limit calculations:`);
			console.log(
				`[AWS] ${new Date().toISOString()} - - Last submission:`,
				lastSubmission,
				new Date(lastSubmission).toISOString()
			);
			console.log(`[AWS] ${new Date().toISOString()} - - Time since last:`, now - lastSubmission, "ms");
			console.log(
				`[AWS] ${new Date().toISOString()} - - Min interval required:`,
				RATE_LIMITS.MIN_INTERVAL_MS,
				"ms"
			);

			// Check minimum interval (12 seconds)
			if (now - lastSubmission < RATE_LIMITS.MIN_INTERVAL_MS) {
				console.log(`[AWS] ${new Date().toISOString()} - ❌ RATE LIMIT BLOCKED: minimum interval not met`);
				console.log(
					`[AWS] ${new Date().toISOString()} - - Need to wait:`,
					RATE_LIMITS.MIN_INTERVAL_MS - (now - lastSubmission),
					"ms more"
				);
				return false;
			}

			// Reset counters if time windows have passed
			let requestsThisMinute = data.aws_requests_minute || 0;
			let requestsThisHour = data.aws_requests_hour || 0;

			console.log(
				`[AWS] ${new Date().toISOString()} - Current counters: minute=${requestsThisMinute}, hour=${requestsThisHour}`
			);

			if (now - minuteStart >= 60000) {
				// 1 minute
				console.log(`[AWS] ${new Date().toISOString()} - Minute window reset (${now - minuteStart}ms passed)`);
				requestsThisMinute = 0;
			}

			if (now - hourStart >= 3600000) {
				// 1 hour
				console.log(`[AWS] ${new Date().toISOString()} - Hour window reset (${now - hourStart}ms passed)`);
				requestsThisHour = 0;
			}

			console.log(
				`[AWS] ${new Date().toISOString()} - Final counters: minute=${requestsThisMinute}/${
					RATE_LIMITS.MAX_REQUESTS_PER_MINUTE
				}, hour=${requestsThisHour}/${RATE_LIMITS.MAX_REQUESTS_PER_HOUR}`
			);

			// Check per-minute limit
			if (requestsThisMinute >= RATE_LIMITS.MAX_REQUESTS_PER_MINUTE) {
				console.log(
					`[AWS] ${new Date().toISOString()} - ❌ RATE LIMIT BLOCKED: per-minute limit exceeded (${requestsThisMinute}/${
						RATE_LIMITS.MAX_REQUESTS_PER_MINUTE
					})`
				);
				return false;
			}

			// Check per-hour limit
			if (requestsThisHour >= RATE_LIMITS.MAX_REQUESTS_PER_HOUR) {
				console.log(
					`[AWS] ${new Date().toISOString()} - ❌ RATE LIMIT BLOCKED: per-hour limit exceeded (${requestsThisHour}/${
						RATE_LIMITS.MAX_REQUESTS_PER_HOUR
					})`
				);
				return false;
			}

			console.log(`[AWS] ${new Date().toISOString()} - ✅ RATE LIMITS PASSED: submission allowed`);
			return true;
		} catch (error) {
			console.error(`[AWS] ${new Date().toISOString()} - ❌ EXCEPTION in shouldSubmitContext():`, error);
			return false; // Default to blocking submission on error
		}
	}

	/**
	 * Get cached insights without making API call
	 */
	async getCachedInsights(): Promise<AIInsight[]> {
		try {
			const data = await chrome.storage.local.get(["cached_insights"]);
			return data.cached_insights || [];
		} catch (error) {
			console.error("[AWS] Failed to get cached insights:", error);
			return [];
		}
	}

	/**
	 * Generate a hash for the active URL
	 */
	private generateUrlHash(workspace: WorkspaceCapture): string {
		const activeTabs = workspace.windows.flatMap((window) => window.tabs.filter((tab) => tab.isActive));

		if (activeTabs.length > 0) {
			return this.hashUrl(activeTabs[0].snapshot.url);
		}

		return "no-active-tab";
	}

	/**
	 * Simple URL hash function
	 */
	private hashUrl(url: string): string {
		let hash = 0;
		for (let i = 0; i < url.length; i++) {
			const char = url.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(16).substr(0, 8);
	}

	/**
	 * Extract text sample from page snapshot
	 */
	private extractTextSample(snapshot: any): string {
		if (snapshot.data) {
			// Google Docs
			if (snapshot.data.documentName) {
				return `Document: ${snapshot.data.documentName}`;
			}
			// Google Sheets
			if (snapshot.data.workbook && snapshot.data.selectedRange) {
				return `Workbook: ${snapshot.data.workbook}, selected ${snapshot.data.selectedRange}`;
			}
			// Article with visible text
			if (snapshot.data.visibleText) {
				return snapshot.data.visibleText.substr(0, 100);
			}
			// Search query
			if (snapshot.data.searchQuery) {
				return `Search: ${snapshot.data.searchQuery}`;
			}
		}

		// Fallback to title
		return snapshot.title ? snapshot.title.substr(0, 100) : "";
	}

	/**
	 * Extract title from summary text
	 */
	private extractTitleFromSummary(summary: string): string {
		// Try to extract title from common patterns
		const titleMatch = summary.match(/On "([^"]+)"/);
		if (titleMatch) {
			return titleMatch[1];
		}

		// Fallback to first sentence
		const sentences = summary.split(".");
		return sentences[0].trim().substr(0, 50);
	}

	/**
	 * Determine priority based on confidence score
	 */
	private determinePriority(confidence: number): "low" | "medium" | "high" {
		if (confidence >= 0.8) return "high";
		if (confidence >= 0.6) return "medium";
		return "low";
	}

	/**
	 * Update rate limiting counters
	 */
	private async updateRateLimitCounters(): Promise<void> {
		try {
			const now = Date.now();
			const data = await chrome.storage.local.get([
				"aws_requests_minute",
				"aws_requests_hour",
				"aws_minute_start",
				"aws_hour_start",
			]);

			const minuteStart = data.aws_minute_start || now;
			const hourStart = data.aws_hour_start || now;

			// Reset counters if time window has passed
			let requestsThisMinute = data.aws_requests_minute || 0;
			let requestsThisHour = data.aws_requests_hour || 0;

			if (now - minuteStart >= 60000) {
				// 1 minute
				requestsThisMinute = 0;
			}

			if (now - hourStart >= 3600000) {
				// 1 hour
				requestsThisHour = 0;
			}

			// Increment counters
			requestsThisMinute++;
			requestsThisHour++;

			await chrome.storage.local.set({
				aws_requests_minute: requestsThisMinute,
				aws_requests_hour: requestsThisHour,
				aws_minute_start: now - minuteStart >= 60000 ? now : minuteStart,
				aws_hour_start: now - hourStart >= 3600000 ? now : hourStart,
				last_aws_submission: now,
			});
		} catch (error) {
			console.error("[AWS] Failed to update rate limit counters:", error);
		}
	}

	private async extractRelatedUrls(correlationId: string): Promise<string[]> {
		try {
			if (!correlationId) {
				return [];
			}

			// Try to find the workspace that matches this correlation ID
			const allData = await chrome.storage.local.get(null);
			const contextKeys = Object.keys(allData).filter((key) => key.startsWith("context_"));

			for (const key of contextKeys) {
				const contextData = allData[key];
				if (contextData && contextData.correlation_id === correlationId) {
					// Extract URLs from the workspace data
					const urls: string[] = [];
					if (contextData.windows) {
						for (const window of contextData.windows) {
							for (const tab of window.tabs) {
								if (
									tab.isActive &&
									tab.snapshot &&
									tab.snapshot.url &&
									tab.snapshot.type !== "general"
								) {
									urls.push(tab.snapshot.url);
								}
							}
						}
					}
					console.log(`[AWS] Found ${urls.length} related URLs for correlation ${correlationId}:`, urls);
					return urls.slice(0, 3); // Limit to 3 most relevant URLs
				}
			}

			// Fallback: get recent active tabs from any workspace
			const workspaceKeys = Object.keys(allData).filter((key) => key.startsWith("workspace_"));
			if (workspaceKeys.length > 0) {
				const sortedKeys = workspaceKeys.sort((a, b) => {
					const timeA = parseInt(a.split("_")[1]) || 0;
					const timeB = parseInt(b.split("_")[1]) || 0;
					return timeB - timeA;
				});

				const recentWorkspace = allData[sortedKeys[0]];
				if (recentWorkspace && recentWorkspace.windows) {
					const urls: string[] = [];
					for (const window of recentWorkspace.windows) {
						for (const tab of window.tabs) {
							if (tab.isActive && tab.snapshot && tab.snapshot.url && tab.snapshot.type !== "general") {
								urls.push(tab.snapshot.url);
							}
						}
					}
					console.log(`[AWS] Using fallback URLs from recent workspace:`, urls);
					return urls.slice(0, 2); // Limit to 2 URLs as fallback
				}
			}

			return [];
		} catch (error) {
			console.error(`[AWS] Error extracting related URLs for ${correlationId}:`, error);
			return [];
		}
	}
}

export default AWSAPIService;
