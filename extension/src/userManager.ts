export class UserManager {
    private static instance: UserManager;
    private userId: string | null = null;

    private constructor() {}

    static getInstance(): UserManager {
        if (!UserManager.instance) {
            UserManager.instance = new UserManager();
        }
        return UserManager.instance;
    }

    async initializeUser(): Promise<string> {
        const stored = await chrome.storage.sync.get(['userId']);
        
        if (stored.userId) {
            return stored.userId;
        } else {
            this.userId = this.generateUUID();
            await chrome.storage.sync.set({ userId: this.userId });
            console.log('[USER] New user:', this.userId.slice(0, 8) + '...');
            return this.userId;
        }
    }

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    getUserId(): string | null {
        return this.userId;
    }
}
