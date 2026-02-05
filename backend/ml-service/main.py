from fastapi import FastAPI
import numpy as np
from pydantic import BaseModel
import joblib

app = FastAPI()

model = joblib.load("model.pkl")

class Tx(BaseModel):
    amount: float
    type: str
    account_id: str
    timestamp: str

@app.post("/score")
def score(tx: Tx):
    x = np.array([[tx.amount]])
    fraud_score = -model.decision_function(x)[0]
    fraud_score = max(0, min(1, fraud_score))
    
    return {"score": fraud_score}
