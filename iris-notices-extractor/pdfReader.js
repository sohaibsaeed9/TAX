// Extracts text from a downloaded PDF file using PDF.js
// PDF.js is loaded from CDN in sidepanel.html

async function extractTextFromPdfBlob(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n\n';
    }

    return fullText.trim();
  } catch (err) {
    console.error('PDF text extraction failed:', err);
    return null;
  }
}

async function extractTextFromPdfUrl(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await extractTextFromPdfBlob(blob);
  } catch (err) {
    console.error('PDF fetch failed:', err);
    return null;
  }
}
