# 📋 eClass MCP: Master TODO

This is the high-level reminder list for the project.

---

## 🚀 High Priority (Current)

### 📄 Intelligent PDF Splicing & Vision Checker
- [ ] **Problem:** Current pipeline uses a 250-char heuristic. It works well, but we need to handle "High-Text + Meaningful Diagram" pages better.
- [ ] **Next Steps:**
    - [ ] Implement local **Entropy check** (Visual complexity detection).
    - [ ] Integrate **Gemini 1.5 Flash Vision** for one-shot diagram classification.
    - [ ] Implement **Smart Splicing** (Sending text + cropped diagram instead of full 1MB page images).
- [ ] **Docs:** [Detailed Roadmap here](./docs/tools/get_file_text/roadmap.md)

---

## 🛠️ Infrastructure & Tools

- [ ] **Course Management:** Fill in specific tool documentation for enrollment/scraping.
- [ ] **Auth System:** Document the session/redirect logic more deeply.
- [ ] **General Docs:** Populate the empty tool folders in `docs/tools/` as features expand.

---

## ✅ Completed (Recent Major Wins)
- [x] **Smart PDF Pipeline v1.5** (Smart text density, pay-per-page rendering).
- [x] **MCP Payload Guardrails** (800KB image limit, 1MB protocol safety).
- [x] **New Build Stack** (pdfjs-dist v5 with @napi-rs/canvas).
