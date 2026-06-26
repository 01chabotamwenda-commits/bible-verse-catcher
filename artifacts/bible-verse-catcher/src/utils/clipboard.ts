/**
 * Copies text to the clipboard.
 * Returns true on success, false on failure.
 * Falls back to document.execCommand for older browsers.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy approach
    }
  }

  // Legacy fallback
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
