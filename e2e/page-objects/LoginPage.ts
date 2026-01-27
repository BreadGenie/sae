import type { Page, Locator } from "@playwright/test";

export class LoginPage {
	readonly page: Page;
	readonly emailInput: Locator;
	readonly passwordInput: Locator;
	readonly loginButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.emailInput = page.getByRole("textbox", { name: "User ID" });
		this.passwordInput = page.getByRole("textbox", { name: "Password" });
		this.loginButton = page.getByRole("button", { name: "Login" });
	}

	async goto() {
		await this.page.goto("/meet/login");
	}

	async login(email: string, password: string) {
		await this.emailInput.fill(email);
		await this.passwordInput.fill(password);
		await this.loginButton.click();
	}

	async waitForLoginComplete() {
		// Wait for redirect away from login page
<<<<<<< HEAD
		await this.page.waitForURL((url) => !url.pathname.includes("/login"));
=======
		await this.page.waitForURL((url) => !url.pathname.includes("/login"), {
			timeout: 15000,
		});
>>>>>>> 9694b54 (test: add e2e tests)
	}

	async loginAndWait(email: string, password: string) {
		await this.login(email, password);
		await this.waitForLoginComplete();
	}
}
