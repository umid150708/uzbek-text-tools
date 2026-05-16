import gradio as gr
from uzbek_text_tools import Transliterator, SpellChecker

transliterator = Transliterator()
spellchecker = SpellChecker()


def transliterate(text: str, direction: str) -> str:
    if direction == "Cyrillic → Latin":
        return transliterator.cyrillic_to_latin(text)
    return transliterator.latin_to_cyrillic(text)


def spellcheck(text: str) -> str:
    words = text.split()
    output = []
    for word in words:
        clean = word.strip(".,!?;:")
        corrected = spellchecker.correct(clean)
        output.append(corrected if corrected != clean else word)
    return " ".join(output)


with gr.Blocks(title="UzbekTextTools") as demo:
    gr.Markdown("# UzbekTextTools Demo")

    with gr.Tab("Transliterator"):
        direction = gr.Radio(
            ["Cyrillic → Latin", "Latin → Cyrillic"], value="Cyrillic → Latin"
        )
        t_input = gr.Textbox(label="Input")
        t_output = gr.Textbox(label="Output", interactive=False)
        gr.Button("Convert").click(transliterate, [t_input, direction], t_output)

    with gr.Tab("Spellchecker"):
        s_input = gr.Textbox(label="Input text")
        s_output = gr.Textbox(label="Corrected text", interactive=False)
        gr.Button("Check").click(spellcheck, s_input, s_output)

if __name__ == "__main__":
    demo.launch()
