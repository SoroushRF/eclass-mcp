# 🗺️ PDF Extraction Pipeline: Master Roadmap

> [!IMPORTANT]
> **PURPOSE:** This document is for **future strategy, brainstorming, and research**. It tracks high-level goals and pending technical challenges. As of 2026-03-23, the baseline T22 PDF pipeline work is complete; for the shipped implementation and history, see [history.md](./history.md).

This document serves as the "source of truth" for the intelligent PDF pipeline. It tracks our architectural decisions, technical constraints, test results, the completed T22 baseline, and future refinements.

---

## 🏗️ Current State (v1.5)
- **Core Engine:** `pdfjs-dist` (v5, ESM-only via dynamic import) + `@napi-rs/canvas`.
- **Classification:** Smart heuristic based on text density (Threshold: **250 chars**).
- **Guardrails:**
    - **1MB Network Limit:** MCP responses are capped at 1MB to prevent Claude Desktop crashes.
    - **Payload Safety:** Internal `800KB` threshold for Base64 image data.
    - **DPI:** `100 DPI` (Standard for safety/clarity balance).
    - **Pagination:** Max 50 pages per call, logic for `startPage` / `endPage` parameters.
- **Output:** Hybrid `ContentBlock` array (Text blocks + PNG images).

---

## 📝 Design Decisions & Constraints

| Decision | Logic / Choice | Context / Reasoning |
|---|---|---|
| **@napi-rs/canvas** | Switch from `canvas` | Native npm `canvas` package requires complex build tools. `@napi-rs` uses prebuilt binaries and is the native target for `pdfjs-dist` v5. |
| **800KB Safety Cap** | 1MB total MCP limit | Base64 encoding adds ~33% size. 800KB raw binary ≈ 1.1MB Base64. We must leave room for JSON overhead. |
| **100 DPI Default** | Balance size/detail | 150 DPI was too heavy (~150KB/page). 100 DPI is ~80KB/page, allowing ~10 full-color images per call. |
| **250 Chars Heuristic**| "Text Density" | If text > 250 chars, we prioritize text extraction. If < 250, we assume it's a visual-heavy slide and render PNG. |
| **Dynamic Cache v2** | MD5(URL) + `_v2` | Cache must be resolution-aware. `v2` forces an update to the new 100 DPI standard. |

---

## 🧪 Test Results Archive

| Date | File | Pages | Result | Learnings |
|---|---|---|---|---|
| 2026-03-19 | `EECS1028-Lec02...` | 19 | **SUCCESS** | At 100 DPI + 250-char rule, 13 pages became text and 6 became images. **All 19 pages fit** in 1MB! |
| 2026-03-19 | `EECS1028-Lec29...` | 6 | **SUCCESS** | Mixed PDF (1 text, 5 image). Stayed under 800KB easily at 100 DPI. |
| 2026-03-18 | `EECS1028 Outline` | 4 | **SUCCESS** | Pure image rendering (due to tables/logos). Crystal clear at 150 DPI initially. |

---

## Completed Baseline and Future Refinements

### **Item 1: Intelligent Image & Diagram Detection (T22)**
**Status:** Implemented in `src/parser/pdf-analyzer.ts` and wired through `get_file_text` as of 2026-03-23.

**Result:** The 250-character rule now works as a shipped baseline alongside page-level image detection, mixed text/image output, and payload caps. The remaining ideas below are future refinements beyond T22.

- Future refinements:
    - Explore **Option A: Visual Entropy.** Measure the binary size of a 20 DPI thumbnail. Complex diagrams = large file, logos = tiny file.
    - Explore **Option B: Vision API.** Pass a 20 DPI thumbnail to a vision model to classify "Meaningful Diagram: YES/NO."
    - Explore **Option C: Splicing.** Extract text AND crop only the *region* of the page containing the image to save payload size.
- **Brainstorming:**
    - We want the "Perfect Result": 100% text searchable + High-res diagrams ONLY.
    - Splicing (Smart Cropping) is the ultimate goal. If we can isolate a 300x300 diagram, that’s only ~30KB, vs ~200KB for a full-page render.
- **Leading Points:**
    - Use Gemini Flash for classification (extremely cheap/fast).
    - Implement a local "Entropy" pre-filter to avoid unnecessary API calls for blank/text-only pages.
