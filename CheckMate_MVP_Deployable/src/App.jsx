import React, { useMemo, useRef, useState } from 'react'
import { createWorker } from 'tesseract.js'

const money = n => `$${Number(n || 0).toFixed(2)}`
const uid = () => Math.random().toString(36).slice(2, 9)
const escPrice = s => Number(String(s).replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0

function preprocessImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const maxW = 1800
        const scale = Math.min(1, maxW / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < data.data.length; i += 4) {
          const r = data.data[i], g = data.data[i+1], b = data.data[i+2]
          let gray = 0.299*r + 0.587*g + 0.114*b
          gray = gray < 165 ? Math.max(0, gray - 35) : Math.min(255, gray + 35)
          data.data[i] = data.data[i+1] = data.data[i+2] = gray
        }
        ctx.putImageData(data, 0, 0)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          blob ? resolve(blob) : reject(new Error('Could not prepare image'))
        }, 'image/jpeg', 0.92)
      } catch (e) { reject(e) }
    }
    img.onerror = reject
    img.src = url
  })
}

function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const summary = { subtotal: null, tax: null, service: 0, total: null }
  const items = []

  const summaryPatterns = [
    ['subtotal', /\bsub[\s-]?total\b/i],
    ['tax', /\b(?:sales\s*)?tax\b/i],
    ['service', /\b(?:service|gratuity|auto\s*grat|service\s*charge)\b/i],
    ['total', /\b(?:grand\s*)?total\b/i],
  ]

  const extractLastPrice = line => {
    const matches = [...line.matchAll(/(?:^|\s|\$)(\d{1,4}(?:[.,]\d{2}))(?!\d)/g)]
    if (!matches.length) return null
    const m = matches[matches.length - 1]
    return { value: escPrice(m[1]), index: m.index + (m[0].length - m[1].length) }
  }

  for (const line of lines) {
    const p = extractLastPrice(line)
    if (!p || p.value <= 0) continue

    let handled = false
    for (const [key, rx] of summaryPatterns) {
      if (rx.test(line)) {
        if (key === 'service') summary.service = p.value
        else summary[key] = p.value
        handled = true
        break
      }
    }
    if (handled) continue

    if (/\b(change|cash|visa|mastercard|amex|discover|tender|balance|amount due|card|auth|approval|tip)\b/i.test(line)) continue
    if (/\b(date|time|server|table|check|receipt|order|guest|thank you|www\.|http|phone)\b/i.test(line)) continue

    let name = line.slice(0, p.index).replace(/[._-]{2,}/g, ' ').replace(/\s+/g, ' ').trim()
    name = name.replace(/^\d+\s*[xX]?\s*/, '').replace(/^[^A-Za-z]+/, '').trim()
    if (name.length < 2 || !/[A-Za-z]/.test(name)) continue

    items.push({ id: uid(), name, price: p.value, owners: [] })
  }

  // Keep duplicate menu lines because receipts often contain repeated drinks/items.
  return { items: items.slice(0, 50), summary, raw: text }
}

export default function App() {
  const [screen, setScreen] = useState('home')
  const [restaurant, setRestaurant] = useState('')
  const [tableName, setTableName] = useState('Dinner')
  const [host, setHost] = useState('Brad')
  const [tableCode] = useState(() => `CM-${Math.floor(1000 + Math.random()*9000)}`)
  const [guests, setGuests] = useState([{ id: 'host', name: 'Brad', method: 'Apple Pay', paid: false }])
  const [newGuest, setNewGuest] = useState('')
  const [receiptFile, setReceiptFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrError, setOcrError] = useState('')
  const [rawOCR, setRawOCR] = useState('')
  const [items, setItems] = useState([])
  const [tax, setTax] = useState(0)
  const [service, setService] = useState(0)
  const [tipPct, setTipPct] = useState(20)
  const [activeGuest, setActiveGuest] = useState('host')
  const cameraRef = useRef(null)
  const uploadRef = useRef(null)

  const subtotal = useMemo(() => items.reduce((s,i)=>s+Number(i.price || 0),0), [items])

  const guestSubtotal = guestId => items.reduce((sum,item)=>{
    if (!item.owners?.includes(guestId)) return sum
    return sum + item.price / item.owners.length
  },0)

  const tipTotal = subtotal * tipPct / 100
  const grandTotal = subtotal + tax + service + tipTotal

  const guestTotal = guestId => {
    const gs = guestSubtotal(guestId)
    if (!subtotal) return 0
    return gs + (gs/subtotal)*(tax + service + tipTotal)
  }

  function go(next){ setScreen(next); window.scrollTo({top:0, behavior:'smooth'}) }

  function createTable(){
    const cleanHost = host.trim() || 'Host'
    setGuests([{ id:'host', name:cleanHost, method:'Apple Pay', paid:false }])
    setActiveGuest('host')
    go('lobby')
  }

  function addGuest(){
    const name = newGuest.trim()
    if (!name) return
    setGuests(g => [...g, { id:uid(), name, method:'Card', paid:false }])
    setNewGuest('')
  }

  function pickReceipt(file){
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setReceiptFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setOcrError('')
    go('receipt')
  }

  async function runOCR(){
    if (!receiptFile) return
    setOcrProgress(0); setOcrStatus('Preparing receipt'); setOcrError('')
    go('processing')
    let worker
    try {
      const prepared = await preprocessImage(receiptFile)
      worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status) setOcrStatus(m.status.replaceAll('_',' '))
          if (typeof m.progress === 'number') setOcrProgress(Math.round(m.progress*100))
        }
      })
      const { data } = await worker.recognize(prepared)
      const parsed = parseReceipt(data.text || '')
      setRawOCR(parsed.raw)
      setItems(parsed.items.length ? parsed.items : [{id:uid(), name:'Item', price:0, owners:[]}])
      if (parsed.summary.tax != null) setTax(parsed.summary.tax)
      if (parsed.summary.service) setService(parsed.summary.service)
      setOcrProgress(100)
      go('review')
    } catch (e) {
      console.error(e)
      setOcrError('I could not read that receipt clearly. Try a brighter, straighter photo, or continue and enter the items manually.')
    } finally {
      if (worker) await worker.terminate()
    }
  }

  function updateItem(id, key, value){
    setItems(xs => xs.map(i => i.id===id ? {...i, [key]: key==='price'?escPrice(value):value} : i))
  }
  function removeItem(id){ setItems(xs => xs.filter(i=>i.id!==id)) }
  function addItem(){ setItems(xs => [...xs,{id:uid(),name:'',price:0,owners:[]}]) }

  function toggleOwner(itemId, guestId){
    setItems(xs => xs.map(i=>{
      if(i.id!==itemId) return i
      const owners = i.owners || []
      return {...i, owners: owners.includes(guestId) ? owners.filter(x=>x!==guestId) : [...owners, guestId]}
    }))
  }

  function changePayment(id, method){
    setGuests(gs => gs.map(g=>g.id===id?{...g,method}:g))
  }

  function markPaid(id){
    setGuests(gs => gs.map(g=>g.id===id?{...g,paid:true}:g))
  }

  function settleAll(){ setGuests(gs => gs.map(g=>({...g,paid:true}))) }

  const claimedCount = items.filter(i=>i.owners?.length).length
  const paidCount = guests.filter(g=>g.paid).length

  return <div className="shell">
    <header className="top">
      <div className="brand"><span className="logo">✓</span><span>CheckMate</span></div>
      <span className="pill">MVP</span>
    </header>

    {screen==='home' && <section className="screen">
      <div className="hero">
        <span className="eyebrow">Social checkout</span>
        <h1>The better way to settle dinner.</h1>
        <p>Scan the receipt, claim what you ordered, split shared items, and close the table without awkward math.</p>
      </div>
      <button className="primary" onClick={()=>go('create')}>Create a Table</button>
      <div className="card soft">
        <strong>Working demo</strong>
        <p>Real receipt OCR. Real item allocation and math. Payments are simulated and no money is collected.</p>
      </div>
    </section>}

    {screen==='create' && <section className="screen">
      <Back onClick={()=>go('home')}/>
      <h2>Create your table</h2>
      <p className="sub">One host starts the checkout for the group.</p>
      <div className="card">
        <Label>Host name</Label>
        <input value={host} onChange={e=>setHost(e.target.value)} />
        <Label>Restaurant</Label>
        <input placeholder="Restaurant name" value={restaurant} onChange={e=>setRestaurant(e.target.value)} />
        <Label>Table name</Label>
        <input value={tableName} onChange={e=>setTableName(e.target.value)} />
        <button className="primary" onClick={createTable}>Create Table</button>
      </div>
    </section>}

    {screen==='lobby' && <section className="screen">
      <Back onClick={()=>go('create')}/>
      <div className="eyebrow">{restaurant || 'Restaurant'}</div>
      <h2>{tableName}</h2>
      <div className="card">
        <div className="split"><div><span className="tiny">TABLE CODE</span><strong className="code">{tableCode}</strong></div><span className="status green">{guests.length} joined</span></div>
      </div>
      <div className="card">
        <div className="split"><strong>Guests</strong><span className="tiny">No account required</span></div>
        {guests.map(g=><div className="guest" key={g.id}><span className="avatar">{g.name[0]?.toUpperCase()}</span><strong>{g.name}</strong><span className="status green">Joined</span></div>)}
        <div className="addrow"><input placeholder="Add guest name" value={newGuest} onChange={e=>setNewGuest(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addGuest()}/><button onClick={addGuest}>Add</button></div>
      </div>
      <button className="primary" onClick={()=>go('upload')}>Add Receipt</button>
    </section>}

    {screen==='upload' && <section className="screen">
      <Back onClick={()=>go('lobby')}/>
      <h2>Add the receipt</h2>
      <p className="sub">Take a clear photo or select one already in your photo library.</p>
      <div className="card uploadbox">
        <div className="receiptIcon">🧾</div>
        <button className="primary" onClick={()=>cameraRef.current?.click()}>Take Receipt Photo</button>
        <button className="secondary" onClick={()=>uploadRef.current?.click()}>Upload from Photos</button>
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>pickReceipt(e.target.files?.[0])}/>
        <input ref={uploadRef} hidden type="file" accept="image/*" onChange={e=>pickReceipt(e.target.files?.[0])}/>
      </div>
    </section>}

    {screen==='receipt' && <section className="screen">
      <Back onClick={()=>go('upload')}/>
      <h2>Receipt ready</h2>
      <p className="sub">Check the photo, then let CheckMate itemize it.</p>
      <div className="card imageCard"><img src={previewUrl} alt="receipt preview"/></div>
      <button className="primary" onClick={runOCR}>Read & Itemize Receipt</button>
      <button className="secondary" onClick={()=>uploadRef.current?.click()}>Choose Another</button>
      <input ref={uploadRef} hidden type="file" accept="image/*" onChange={e=>pickReceipt(e.target.files?.[0])}/>
    </section>}

    {screen==='processing' && <section className="screen center">
      <div className="processingOrb">⌁</div>
      <h2>Reading your receipt…</h2>
      <p className="sub">{ocrStatus || 'Finding items and prices'}</p>
      <div className="progress"><span style={{width:`${ocrProgress}%`}}/></div>
      <strong>{ocrProgress}%</strong>
      {ocrError && <div className="errorBox">
        <strong>Receipt read needs help</strong>
        <p>{ocrError}</p>
        <button className="primary" onClick={()=>go('review')}>Enter / Correct Items</button>
        <button className="secondary" onClick={()=>go('upload')}>Try Another Photo</button>
      </div>}
    </section>}

    {screen==='review' && <section className="screen">
      <Back onClick={()=>go('receipt')}/>
      <h2>Review receipt</h2>
      <p className="sub">Correct anything OCR missed before the table starts claiming.</p>
      <div className="card">
        {items.map(i=><div className="editItem" key={i.id}>
          <input className="nameInput" value={i.name} placeholder="Item name" onChange={e=>updateItem(i.id,'name',e.target.value)} />
          <input className="priceInput" inputMode="decimal" value={i.price} onChange={e=>updateItem(i.id,'price',e.target.value)} />
          <button className="remove" onClick={()=>removeItem(i.id)}>×</button>
        </div>)}
        <button className="ghost" onClick={addItem}>+ Add Item</button>
      </div>
      <div className="card">
        <div className="summary"><span>Items</span><strong>{items.length}</strong><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
        <Label>Tax from receipt</Label><input inputMode="decimal" value={tax} onChange={e=>setTax(escPrice(e.target.value))}/>
        <Label>Service / automatic gratuity</Label><input inputMode="decimal" value={service} onChange={e=>setService(escPrice(e.target.value))}/>
      </div>
      <details className="raw"><summary>View raw OCR text</summary><pre>{rawOCR || 'No raw OCR text available.'}</pre></details>
      <button className="primary" onClick={()=>go('claim')}>Confirm Receipt</button>
    </section>}

    {screen==='claim' && <section className="screen">
      <Back onClick={()=>go('review')}/>
      <h2>Claim your items</h2>
      <p className="sub">Select a guest, then tap every item they had. Tap the same item for multiple guests to split it equally.</p>
      <div className="guestTabs">{guests.map(g=><button key={g.id} className={activeGuest===g.id?'guestTab active':'guestTab'} onClick={()=>setActiveGuest(g.id)}>{g.name}</button>)}</div>
      <div className="card">
        {items.map(i=>{
          const on=i.owners?.includes(activeGuest)
          return <button key={i.id} className={on?'claimItem claimed':'claimItem'} onClick={()=>toggleOwner(i.id,activeGuest)}>
            <span><strong>{i.name || 'Unnamed item'}</strong><small>{i.owners?.length>1?`Shared ${i.owners.length} ways`:i.owners?.length===1?'Claimed':'Unclaimed'}</small></span>
            <span><b>{money(i.price)}</b><em>{on?'✓':'+'}</em></span>
          </button>
        })}
      </div>
      <div className="card">
        <div className="split"><span>{claimedCount} of {items.length} items assigned</span><strong>{money(guestSubtotal(activeGuest))}</strong></div>
      </div>
      {claimedCount<items.length && <div className="warning">Unclaimed items remain. You can continue for demo purposes, but CheckMate flags them before final settlement.</div>}
      <button className="primary" onClick={()=>go('tip')}>Continue</button>
    </section>}

    {screen==='tip' && <section className="screen">
      <Back onClick={()=>go('claim')}/>
      <h2>Choose tip</h2>
      <p className="sub">Tax, service charge, and tip are allocated proportionally to each guest's claimed subtotal.</p>
      <div className="tipGrid">{[18,20,22,25].map(p=><button key={p} className={tipPct===p?'tip active':'tip'} onClick={()=>setTipPct(p)}>{p}%</button>)}</div>
      <div className="card summary">
        <span>Subtotal</span><strong>{money(subtotal)}</strong>
        <span>Tax</span><strong>{money(tax)}</strong>
        <span>Service</span><strong>{money(service)}</strong>
        <span>Tip ({tipPct}%)</span><strong>{money(tipTotal)}</strong>
        <span className="big">Table total</span><strong className="big">{money(grandTotal)}</strong>
      </div>
      <button className="primary" onClick={()=>go('payments')}>Review Payments</button>
    </section>}

    {screen==='payments' && <section className="screen">
      <Back onClick={()=>go('tip')}/>
      <h2>Payment setup</h2>
      <p className="sub">Choose how each guest is paying. The demo tracks completion without collecting money.</p>
      {guests.map(g=><div className="card paymentCard" key={g.id}>
        <div className="split"><div><strong>{g.name}</strong><div className="tiny">{money(guestTotal(g.id))}</div></div><span className={g.paid?'status green':'status amber'}>{g.paid?'Paid':'Pending'}</span></div>
        <select value={g.method} onChange={e=>changePayment(g.id,e.target.value)}>
          <option>Apple Pay</option><option>Card</option><option>Cash</option><option>Covered by Host</option>
        </select>
        <button className={g.paid?'secondary':'primary'} onClick={()=>markPaid(g.id)}>{g.paid?'Payment Recorded':'Simulate Payment'}</button>
      </div>)}
      <button className="primary" onClick={()=>go('dashboard')}>Open Settlement Dashboard</button>
    </section>}

    {screen==='dashboard' && <section className="screen">
      <h2>Settlement Dashboard</h2>
      <p className="sub">The host can see exactly what is still outstanding.</p>
      <div className="card">
        <div className="split"><strong>{paidCount} of {guests.length} settled</strong><span>{money(guests.filter(g=>!g.paid).reduce((s,g)=>s+guestTotal(g.id),0))} remaining</span></div>
        <div className="progress"><span style={{width:`${guests.length?paidCount/guests.length*100:0}%`}}/></div>
      </div>
      <div className="card">{guests.map(g=><div className="guest" key={g.id}>
        <span className="avatar">{g.name[0]?.toUpperCase()}</span>
        <span className="grow"><strong>{g.name}</strong><small>{g.method} · {money(guestTotal(g.id))}</small></span>
        <span className={g.paid?'status green':'status amber'}>{g.paid?'Paid':'Pending'}</span>
      </div>)}</div>
      {paidCount<guests.length ? <button className="primary" onClick={settleAll}>Complete Remaining Demo Payments</button> : <button className="primary" onClick={()=>go('settled')}>Finish Table</button>}
    </section>}

    {screen==='settled' && <section className="screen center">
      <div className="check">✓</div>
      <span className="eyebrow">Table settled</span>
      <h1 className="settledTitle">Check Mate.</h1>
      <p className="sub">Everyone's portion is complete.</p>
      <div className="card summary">
        <span>Restaurant</span><strong>{restaurant || 'Restaurant'}</strong>
        <span>Guests</span><strong>{guests.length}</strong>
        <span>Final total</span><strong>{money(grandTotal)}</strong>
        <span>Table code</span><strong>{tableCode}</strong>
      </div>
      <button className="primary" onClick={()=>location.reload()}>Start Another Table</button>
    </section>}
  </div>
}

function Label({children}){ return <div className="label">{children}</div> }
function Back({onClick}){ return <button className="back" onClick={onClick}>← Back</button> }
