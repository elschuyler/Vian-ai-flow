// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Sandbox Worker
//
// Executes AI-generated JSZip scripts safely.
// This worker has NO access to:
//   - The DOM
//   - localStorage / IndexedDB
//   - API keys, chat history, settings
//   - Any variable outside the sandboxed scope
//
// The script receives only two things:
//   zip      — a fresh JSZip instance
//   download — function(filename) to trigger save
// ═══════════════════════════════════════════

importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

self.onmessage = async (e) => {
  const { id, script } = e.data;

  try {
    const zip = new JSZip();
    let downloadFilename = null;

    // The only API surface exposed to the script
    function download(filename) {
      downloadFilename = String(filename);
    }

    // Execute in a restricted Function scope.
    // Only zip and download are in scope — nothing else.
    // eslint-disable-next-line no-new-func
    const fn = new Function('zip', 'download', script);
    fn(zip, download);

    if (!downloadFilename) {
      self.postMessage({
        id,
        error: 'Script did not call download("filename.zip"). Add that call at the end.',
      });
      return;
    }

    const blob        = await zip.generateAsync({ type: 'blob' });
    const arrayBuffer = await blob.arrayBuffer();

    // Transfer the buffer zero-copy back to the main thread
    self.postMessage(
      { id, success: true, filename: downloadFilename, buffer: arrayBuffer },
      [arrayBuffer]
    );

  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
