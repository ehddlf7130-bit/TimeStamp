export interface NamedBlob { name: string; blob: Blob; lastModified?: number }

export function canShareFiles(files: File[]): boolean {
  try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files }); }
  catch { return false; }
}

/**
 * Opens the share sheet (iPhone: "이미지 저장" saves to Photos).
 * Returns false if the user cancelled, throws if sharing files is unsupported.
 */
export async function shareFiles(items: NamedBlob[]): Promise<boolean> {
  const files = items.map((i) => new File([i.blob], i.name, { type: i.blob.type, lastModified: i.lastModified }));
  if (!canShareFiles(files)) throw new Error('이 브라우저는 사진 공유를 지원하지 않습니다. 사진별 이미지 다운로드를 이용해 주세요.');
  try {
    await navigator.share({ files });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

/**
 * Saves photos one share sheet at a time, in the given order.
 * iPhone's "이미지 N개 저장" writes a multi-file share concurrently and dates each photo
 * by when it was saved, not by its EXIF, so even the Photos "Date Captured" view
 * shows a batch out of order. One file per share makes the save order the
 * chronological order. Each call to next() must come from its own tap.
 */
export class OrderedShare {
  private index = 0;
  private busy = false;
  constructor(readonly items: NamedBlob[], private share: (items: NamedBlob[]) => Promise<boolean> = shareFiles) {}

  get saved() { return this.index; }
  get done() { return this.index >= this.items.length; }
  get current(): NamedBlob | undefined { return this.items[this.index]; }

  /** true: this photo was saved. false: cancelled, or a sheet is still open. Throws on failure; the same photo is retried. */
  async next(): Promise<boolean> {
    const item = this.current;
    if (!item || this.busy) return false;
    this.busy = true;
    try {
      // Called without awaiting first, so the share stays within the user's tap.
      const ok = await this.share([item]);
      if (ok) this.index++;
      return ok;
    } finally { this.busy = false; }
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
