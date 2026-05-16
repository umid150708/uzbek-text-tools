from setuptools import setup, find_packages

setup(
    name="uzbek-text-tools",
    version="0.1.0",
    description="Uzbek NLP toolkit: transliterator, spellchecker, and processing pipeline",
    author="umid150708",
    packages=find_packages(exclude=["tests*", "notebooks*", "demo*"]),
    package_data={"uzbek_text_tools": ["data/*.json"]},
    python_requires=">=3.10",
    install_requires=[
        "python-Levenshtein",
        "gradio",
    ],
    extras_require={
        "dev": ["pytest"],
    },
)
