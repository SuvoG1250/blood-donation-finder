from fastapi import FastAPI
from pydantic import BaseModel
from transformers import pipeline

app = FastAPI(title="Raktodaan AI Service", version="1.0.0")


class RewriteReq(BaseModel):
    text: str


class TranslateReq(BaseModel):
    text: str
    target: str  # "bn" or "en"


class SpamReq(BaseModel):
    text: str


_rewrite = None
_en_bn = None
_bn_en = None
_spam = None


def get_rewrite():
    global _rewrite
    if _rewrite is None:
        # Small instruction-following model (CPU friendly)
        _rewrite = pipeline("text2text-generation", model="google/flan-t5-small")
    return _rewrite


def get_translator(target: str):
    global _en_bn, _bn_en
    if target == "bn":
        if _en_bn is None:
            _en_bn = pipeline("translation", model="Helsinki-NLP/opus-mt-en-bn")
        return _en_bn
    if target == "en":
        if _bn_en is None:
            _bn_en = pipeline("translation", model="Helsinki-NLP/opus-mt-bn-en")
        return _bn_en
    raise ValueError("Unsupported target")


def get_spam():
    global _spam
    if _spam is None:
        _spam = pipeline("text-classification", model="mrm8488/bert-tiny-finetuned-sms-spam-detection")
    return _spam


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/rewrite")
def rewrite(req: RewriteReq):
    text = (req.text or "").strip()
    if not text:
        return {"ok": False, "error": "Missing text"}
    prompt = (
        "Rewrite this emergency blood request into a clear short message. "
        "Keep phone numbers and important details. Output plain text.\n\n"
        f"Text:\n{text}"
    )
    out = get_rewrite()(prompt, max_length=220, do_sample=False)
    best = out[0]["generated_text"] if out else ""
    return {"ok": True, "text": best.strip()}


@app.post("/translate")
def translate(req: TranslateReq):
    text = (req.text or "").strip()
    if not text:
        return {"ok": False, "error": "Missing text"}
    target = (req.target or "").strip().lower()
    if target not in ("bn", "en"):
        return {"ok": False, "error": "target must be bn or en"}
    out = get_translator(target)(text, max_length=300)
    best = out[0]["translation_text"] if out else ""
    return {"ok": True, "text": best.strip(), "target": target}


@app.post("/spam-check")
def spam_check(req: SpamReq):
    text = (req.text or "").strip()
    if not text:
        return {"ok": False, "error": "Missing text"}
    out = get_spam()(text)
    best = out[0] if out else {"label": "unknown", "score": 0.0}
    label = str(best.get("label", "unknown"))
    score = float(best.get("score", 0.0))
    # Normalize: model labels are typically "spam" / "ham"
    is_spam = label.lower().startswith("spam")
    return {"ok": True, "is_spam": is_spam, "label": label, "score": score}

