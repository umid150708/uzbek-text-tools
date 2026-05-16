from setuptools import setup, find_packages

setup(
    name="uzbek-text-tools",
    version="0.2.0",
    author="umid150708",
    author_email="",
    description="Uzbek Cyrillic-Latin transliterator and spell checker",
    long_description=open("README.md", encoding="utf-8").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/umid150708/uzbek-text-tools",
    packages=find_packages(exclude=["tests*", "notebooks*", "demo*", "scripts*"]),
    package_data={"uzbek_text_tools": ["data/*.json"]},
    install_requires=["huggingface_hub"],
    python_requires=">=3.8",
    classifiers=[
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Operating System :: OS Independent",
        "Topic :: Text Processing :: Linguistic",
        "Intended Audience :: Developers",
        "Intended Audience :: Science/Research",
    ],
    keywords="uzbek nlp transliteration spellcheck cyrillic latin",
)
