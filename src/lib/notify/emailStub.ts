export function sendEmailStub(email: string, chapterPaths: string[]): void {
  console.info(
    `[email-stub] To: ${email}\nDownloads:\n${chapterPaths.map((p) => `  - ${p}`).join("\n")}`,
  );
}
