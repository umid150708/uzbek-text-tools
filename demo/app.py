import gradio as gr
from uzbek_text_tools import UzbekTextPipeline, transliterate as cyr_to_lat
from uzbek_text_tools.transliterator import Transliterator

pipeline = UzbekTextPipeline()
_t = Transliterator()


# ------------------------------------------------------------------
# Tab 1: Transliterator
# ------------------------------------------------------------------

def run_transliterate(text: str, direction: str) -> str:
    if not text.strip():
        return ""
    if direction == "Cyrillic → Latin":
        return cyr_to_lat(text)
    return _t.latin_to_cyrillic(text)


# ------------------------------------------------------------------
# Tab 2: Spell Checker
# ------------------------------------------------------------------

def run_spellcheck(text: str) -> tuple[str, str]:
    if not text.strip():
        return "", "No input."
    result = pipeline.process(text, script="latin")
    sc = result["spell_check"]

    # Build corrected text — replace each misspelled token with top suggestion
    corrections = {e["word"]: e["suggestions"][0] for e in sc["errors"] if e["suggestions"]}
    words = text.split()
    corrected_words = [corrections.get(w, w) for w in words]
    corrected = " ".join(corrected_words)

    # Build human-readable report
    if sc["errors_found"] == 0:
        report = f"All {sc['total_words']} words look correct."
    else:
        lines = [f"Found {sc['errors_found']} error(s) out of {sc['total_words']} words:\n"]
        for e in sc["errors"]:
            sugg = ", ".join(e["suggestions"]) if e["suggestions"] else "no suggestion"
            lines.append(f"  • {e['word']}  →  {sugg}")
        report = "\n".join(lines)

    return corrected, report


# ------------------------------------------------------------------
# Tab 3: Pipeline (Cyrillic in → transliterate + spellcheck)
# ------------------------------------------------------------------

def run_pipeline(text: str, script: str) -> tuple[str, str, str]:
    if not text.strip():
        return "", "", "No input."
    sc_script = "cyrillic" if script == "Cyrillic" else "latin"
    result = pipeline.process(text, script=sc_script)
    sc = result["spell_check"]

    converted = result["converted"]

    # Corrected text
    corrections = {e["word"]: e["suggestions"][0] for e in sc["errors"] if e["suggestions"]}
    words = converted.split()
    corrected = " ".join([corrections.get(w, w) for w in words])

    # Report
    if sc["errors_found"] == 0:
        report = f"All {sc['total_words']} words look correct."
    else:
        lines = [f"{sc['errors_found']} error(s) in {sc['total_words']} words:\n"]
        for e in sc["errors"]:
            sugg = ", ".join(e["suggestions"]) if e["suggestions"] else "no suggestion"
            lines.append(f"  • {e['word']}  →  {sugg}")
        report = "\n".join(lines)

    return converted, corrected, report


# ------------------------------------------------------------------
# UI
# ------------------------------------------------------------------

DESCRIPTION = """
# UzbekTextTools Demo
Uzbek Cyrillic↔Latin transliterator and spell checker.
Built from a 513,000-word frequency dictionary extracted from Uzbek Wikipedia.
"""

with gr.Blocks(title="UzbekTextTools") as demo:
    gr.Markdown(DESCRIPTION)

    # --- Tab 1: Transliterator ---
    with gr.Tab("Transliterator"):
        gr.Markdown("Convert Uzbek text between Cyrillic and Latin scripts.")
        direction = gr.Radio(
            ["Cyrillic → Latin", "Latin → Cyrillic"],
            value="Cyrillic → Latin",
            label="Direction",
        )
        with gr.Row():
            t_input = gr.Textbox(label="Input", lines=5, placeholder="Type or paste Uzbek text here...")
            t_output = gr.Textbox(label="Output", lines=5, interactive=False)
        t_btn = gr.Button("Convert", variant="primary")
        t_btn.click(run_transliterate, [t_input, direction], t_output)

        gr.Examples(
            examples=[
                ["Салом, дўстлар! Ўзбекистон — буюк давлат.", "Cyrillic → Latin"],
                ["Salom, do'stlar! O'zbekiston — buyuk davlat.", "Latin → Cyrillic"],
                ["Европа метрополияси", "Cyrillic → Latin"],
            ],
            inputs=[t_input, direction],
        )

    # --- Tab 2: Spell Checker ---
    with gr.Tab("Spell Checker"):
        gr.Markdown("Check and correct Latin-script Uzbek text.")
        s_input = gr.Textbox(label="Input (Latin script)", lines=4, placeholder="e.g. Bu kitoob juda yaxshi")
        s_btn = gr.Button("Check", variant="primary")
        with gr.Row():
            s_corrected = gr.Textbox(label="Auto-corrected text", lines=4, interactive=False)
            s_report = gr.Textbox(label="Error report", lines=4, interactive=False)
        s_btn.click(run_spellcheck, s_input, [s_corrected, s_report])

        gr.Examples(
            examples=[
                ["Bu kitoob juda yaxshi"],
                ["Oʻzbekiston mustaqil davlat"],
                ["shaharr va qishloq"],
            ],
            inputs=s_input,
        )

    # --- Tab 3: Full Pipeline ---
    with gr.Tab("Full Pipeline"):
        gr.Markdown("Paste Cyrillic **or** Latin text — the pipeline transliterates then spell-checks in one step.")
        with gr.Row():
            p_input = gr.Textbox(label="Input text", lines=5, placeholder="Paste Cyrillic or Latin Uzbek text...")
            p_script = gr.Radio(["Cyrillic", "Latin"], value="Cyrillic", label="Input script")
        p_btn = gr.Button("Run Pipeline", variant="primary")
        with gr.Row():
            p_converted = gr.Textbox(label="Transliterated (Latin)", lines=4, interactive=False)
            p_corrected = gr.Textbox(label="Auto-corrected", lines=4, interactive=False)
        p_report = gr.Textbox(label="Spell-check report", lines=4, interactive=False)
        p_btn.click(run_pipeline, [p_input, p_script], [p_converted, p_corrected, p_report])

        gr.Examples(
            examples=[
                ["Бу китооб жуда яхши", "Cyrillic"],
                ["Ўзбекистон мустақил давлат", "Cyrillic"],
                ["Bu kitoob juda yaxshi", "Latin"],
            ],
            inputs=[p_input, p_script],
        )

    gr.Markdown(
        "Source: [github.com/umid150708/uzbek-text-tools](https://github.com/umid150708/uzbek-text-tools) "
        "| Install: `pip install uzbek-text-tools`"
    )

if __name__ == "__main__":
    demo.launch()
