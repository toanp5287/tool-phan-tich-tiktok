const finite=value=>typeof value==='number' && Number.isFinite(value);
export function hasChartData(spec){return spec.type==='relationship'?Array.isArray(spec.edges)&&spec.edges.length>0:Array.isArray(spec.values)&&spec.values.some(finite);}
export function renderIntelligenceChart(spec){
 if(!hasChartData(spec))return null;
 if(spec.type==='relationship'){
  const parent=document.getElementById('graph-'+spec.id);if(!parent)return null;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 500');svg.setAttribute('role','img');svg.setAttribute('aria-label',spec.title);svg.style.width='100%';
  const nodes=(spec.nodes||[]).slice(0,60),positions=new Map(nodes.map((node,i)=>[node.id,{x:100+(i%5)*175,y:35+Math.floor(i/5)*40}]));
  svg.setAttribute('viewBox',`0 0 1000 ${Math.max(150,Math.ceil(nodes.length/5)*40+40)}`);
  for(const edge of spec.edges||[]){const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)continue;const line=document.createElementNS(ns,'line');for(const [k,v] of Object.entries({x1:a.x,y1:a.y,x2:b.x,y2:b.y}))line.setAttribute(k,String(v));const title=document.createElementNS(ns,'title');title.textContent=edge.evidenceId;line.append(title);svg.append(line);}
  for(const node of nodes){const p=positions.get(node.id),g=document.createElementNS(ns,'g'),dot=document.createElementNS(ns,'circle'),text=document.createElementNS(ns,'text');dot.setAttribute('cx',p.x);dot.setAttribute('cy',p.y);dot.setAttribute('r','5');dot.setAttribute('fill','#2563eb');text.setAttribute('x',p.x+8);text.setAttribute('y',p.y+4);text.textContent=node.label.slice(0,22);const title=document.createElementNS(ns,'title');title.textContent=node.id+' · '+node.label;g.append(title,dot,text);svg.append(g);}
  parent.replaceChildren(svg);if((spec.nodes||[]).length>60){const note=document.createElement('p');note.textContent='Sơ đồ giới hạn 60 node để đọc được; xem toàn bộ quan hệ trong evidence.';parent.append(note);}return null;
 }
 const canvas=document.getElementById('chart-'+spec.id);if(!canvas||!window.Chart)return null;
 if(!Array.isArray(spec.labels)||spec.labels.length!==spec.values.length)return null;
 const values=spec.values.map(value=>finite(value)?value:null);
 return new Chart(canvas,{type:spec.type,data:{labels:spec.labels,datasets:[{label:spec.title+' · '+spec.dataKind,data:values,backgroundColor:spec.type==='doughnut'?['#2563eb','#0891b2','#d97706','#16a34a','#7c3aed']:'#2563eb',borderColor:'#2563eb',borderWidth:2,pointRadius:values.filter(finite).length===1?5:2,spanGaps:false}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:spec.type==='doughnut'},tooltip:{callbacks:{afterLabel:()=>`${spec.unit} · ${spec.dataKind} · ${spec.period}`}}},...(spec.type==='doughnut'?{}:{scales:{y:{beginAtZero:spec.type==='bar'},x:{ticks:{maxRotation:30}}}})}});
}
