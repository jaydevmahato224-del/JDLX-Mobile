import pdfplumber
import re
from typing import List, Dict

def _parse_price(price_str: str) -> float:
    """Cleans currency symbols and converts string to float"""
    if not price_str: return 0.0
    clean = re.sub(r'[^\d.]', '', price_str)
    try:
        return float(clean)
    except:
        return 0.0

def extract_invoice_data(pdf_path: str) -> Dict:
    """
    Parses a PDF supplier invoice looking for tabular product data.
    Returns a dictionary with extracted supplier info and a list of line items.
    """
    extracted_data = {
        "supplier_name": "Unknown Supplier",
        "invoice_number": "INV-" + str(pdf_path)[-6:],
        "items": []
    }
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            text_block = ""
            # Extract basic text across first pages to find Vendor Name
            for page in pdf.pages[:2]:
                text_block += page.extract_text() + "\n"
                
                # Try sniffing tabular data
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row: continue
                        # Clean empty cells
                        row = [str(cell).strip() if cell else "" for cell in row]
                        
                        # Basic heuristic: if row has a Name, Qty, and Price-like structure
                        # It is very hard to build a one-size-fits-all regex without a strict template.
                        # This covers generic column formats: [SKU, Name, Category, Qty, PurchasePrice, SellingPrice] 
                        
                        # Look for digits to signify a qty/price data row
                        has_digits = any(bool(re.search(r'\d', cell)) for cell in row)
                        if has_digits and len(row) >= 3:
                            
                            # Let's try to map the row intelligently by guessing column positions.
                            # Usually Name is the longest string, or column 1.
                            
                            # Extremely simple fallback mapping for MVP:
                            name = row[1] if len(row) > 1 and len(row[1]) > 3 else row[0]
                            sku = row[0] if len(row[0]) < 10 else f"SKU-{len(extracted_data['items'])+1}"
                            
                            # Just scan the row for the first standalone integer (qty) and the first floats (prices)
                            qty = 1
                            prices = []
                            for cell in row:
                                if re.fullmatch(r'\d+', cell) and int(cell) < 10000:
                                    qty = int(cell)
                                elif re.search(r'\d+\.\d{2}', cell):
                                    prices.append(_parse_price(cell))
                                    
                            purchase_price = prices[0] if len(prices) > 0 else 0.0
                            selling_price = prices[1] if len(prices) > 1 else purchase_price * 1.3 # 30% markup fallback
                            
                            # Avoid appending header rows
                            if name.lower() not in ["name", "product", "description", "item"]:
                                extracted_data["items"].append({
                                    "product_name": name,
                                    "sku": sku,
                                    "category": "Uncategorized",
                                    "quantity": qty,
                                    "purchase_price": purchase_price,
                                    "selling_price": round(selling_price, 2)
                                })

            # Heuristics for Supplier Name
            # Look for lines containing "Vendor:", "Supplier:", "To:"
            supplier_match = re.search(r'(?i)(?:vendor|supplier|from)\s*:\s*(.+)', text_block)
            if supplier_match:
                extracted_data["supplier_name"] = supplier_match.group(1).strip()
                
            # If table extraction failed, try a very rudimentary regex pass on raw text
            if not extracted_data["items"]:
                lines = text_block.split('\n')
                for line in lines:
                    # Look for: SKU Name 10 $5.00
                    match = re.search(r'^([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+[\$£€₹]?([\d\.]+)', line)
                    if match:
                        sku, name, qty, price = match.groups()
                        extracted_data["items"].append({
                            "product_name": name.strip(),
                            "sku": sku.strip(),
                            "category": "Uncategorized",
                            "quantity": int(qty),
                            "purchase_price": float(price),
                            "selling_price": round(float(price) * 1.3, 2)
                        })

    except Exception as e:
        print(f"[OCR Engine] Extraction failed: {e}")
        
    return extracted_data
