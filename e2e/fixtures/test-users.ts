// Note: Test users must be created in before running tests

export interface TestUser {
	email: string;
	password: string;
	fullName: string;
}

export const TEST_USERS = {
	// Primary user - use this as host
	user1: {
		email: "test-user-1@example.com",
		password: "test-password-123",
		fullName: "Test User One",
	},

	// Rest of them should be used as participants in multi-user tests
	user2: {
		email: "test-user-2@example.com",
		password: "test-password-123",
		fullName: "Test User Two",
	},
	user3: {
		email: "test-user-3@example.com",
		password: "test-password-123",
		fullName: "Test User Three",
	},
	user4: {
		email: "test-user-4@example.com",
		password: "test-password-123",
		fullName: "Test User Four",
	},
} as const satisfies Record<string, TestUser>;

export type TestUserKey = keyof typeof TEST_USERS;
