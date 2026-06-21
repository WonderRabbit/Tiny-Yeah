// Ambient declaration for the optional peer dependency `playwright` (REQ-TY-016).
// `playwright` lives in package.json `optionalDependencies` and is imported DYNAMICICALLY by
// core/pipeline/validate/playwright-driver.ts. When playwright is NOT installed (the default —
// `npm install` does not pull optionalDependencies), TypeScript needs a type stub so the dynamic
// import type-checks. This declares only the minimal slice the driver consumes; it does NOT make
// playwright available at runtime. When a user installs playwright, the real bundled types take
// precedence (TypeScript resolves the real package over this ambient stub when both are present).

declare module "playwright" {
  export interface PlaywrightResponse {
    ok(): boolean;
  }
  export interface PlaywrightPage {
    goto(
      url: string,
      options?: {
        timeout?: number;
        waitUntil?: "load" | "domcontentloaded" | "networkidle";
      },
    ): Promise<PlaywrightResponse | null>;
    locator(selector: string): { innerText(options?: { timeout?: number }): Promise<string> };
  }
  export interface PlaywrightBrowser {
    newPage(): Promise<PlaywrightPage>;
    close(): Promise<void>;
  }
  export interface PlaywrightChromium {
    launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
  }
  export const chromium: PlaywrightChromium;
}
