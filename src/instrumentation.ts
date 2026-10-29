export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initNeatlogs } = await import("@/lib/neatlogs/init");
    await initNeatlogs("book-research");
  }
}
