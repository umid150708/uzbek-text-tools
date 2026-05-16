import gradio as gr
from uzbek_text_tools.pipeline import UzbekTextPipeline

pipe = UzbekTextPipeline()


def run_pipeline(text: str, script_choice: str) -> str:
    if not text.strip():
        return "Please enter some Uzbek text."
    script = "cyrillic" if script_choice == "Cyrillic" else "latin"
    result = pipe.process(text, script=script)

    output = f"Converted text:\n{result['converted']}\n\n"
    output += f"Words checked: {result['spell_check']['total_words']}\n"
    output += f"Errors found:  {result['spell_check']['errors_found']}\n"

    if result["spell_check"]["errors"]:
        output += "\nErrors and suggestions:\n"
        for err in result["spell_check"]["errors"]:
            suggestions = ", ".join(err["suggestions"]) if err["suggestions"] else "no suggestion"
            output += f"  '{err['word']}' → {suggestions}\n"
    else:
        output += "\nNo spelling errors found."

    return output


demo = gr.Interface(
    fn=run_pipeline,
    inputs=[
        gr.Textbox(label="Enter Uzbek text", lines=5,
                   placeholder="e.g. Бу китооб жуда яхши  or  Bu kitoob juda yaxshi"),
        gr.Radio(["Latin", "Cyrillic"], label="Input script", value="Latin"),
    ],
    outputs=gr.Textbox(label="Result", lines=12),
    title="UzbekTextTools",
    description=(
        "Uzbek Cyrillic↔Latin transliterator and spell checker. "
        "Built from a 513,000-word frequency dictionary extracted from Uzbek Wikipedia. "
        "Source: [github.com/umid150708/uzbek-text-tools](https://github.com/umid150708/uzbek-text-tools)"
    ),
    examples=[
        ["Бу китооб жуда яхши", "Cyrillic"],
        ["Ўзбекистон мустақил давлат", "Cyrillic"],
        ["Bu kitoob juda yaxshi", "Latin"],
        ["shaharr va qishloq", "Latin"],
    ],
    allow_flagging="never",
)

demo.launch()
