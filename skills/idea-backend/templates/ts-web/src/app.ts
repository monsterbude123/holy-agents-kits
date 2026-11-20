export function createApp(root: string): void {
  const el = document.querySelector(root);
  if (!el) {
    throw new Error(`missing element ${root}`);
  }
  el.textContent = 'Hello, TypeScript + IDEA!';
}
