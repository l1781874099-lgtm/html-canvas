import { document, getComputedStyle } from '../environment';

function copyBox(element: Element): HTMLElement {
  const computed=getComputedStyle(element);
  const label=document.createElement('div');
  for(let i=0;i<computed.length;i++){
    const property=computed.item(i);
    label.style.setProperty(property,computed.getPropertyValue(property));
  }
  return label;
}

// Single-line controls center their text vertically; a plain div would not.
function centerContent(label: HTMLElement, computed: CSSStyleDeclaration) {
  label.style.display=computed.display.startsWith('inline')?'inline-flex':'flex';
  label.style.alignItems='center';
  label.style.justifyContent=/center/.test(computed.textAlign)?'center':/right|end/.test(computed.textAlign)?'flex-end':'flex-start';
}

// Input values and placeholders aren't DOM text nodes. Materialize a static
// label at the same computed box so the normal text parser can import it.
export function materializeFormLabels(root: Element) {
  for(const element of Array.from(root.querySelectorAll('input,textarea'))){
    const control=element as HTMLInputElement | HTMLTextAreaElement;
    const type=(element.getAttribute('type') || 'text').toLowerCase();
    const textarea=element.tagName.toLowerCase()==='textarea';
    const button=['submit','button','reset'].includes(type);
    if(!['text','email','search','url','tel','number','password'].includes(type) && !textarea && !button)continue;
    let value=control.value || control.getAttribute('value') || '';
    const placeholder=!value;
    value=value || control.getAttribute('placeholder') || '';
    if(!value)continue;
    if(type==='password' && !placeholder)value='•'.repeat(value.length);
    const computed=getComputedStyle(element);
    const label=copyBox(element);
    if(placeholder){
      const pseudo=getComputedStyle(element,'::placeholder');
      label.style.color=pseudo.color || computed.color;
      label.style.opacity=pseudo.opacity || computed.opacity;
    }
    label.style.whiteSpace=textarea?'pre-wrap':'pre';
    label.style.overflow='hidden';
    if(!textarea)centerContent(label,computed);
    if(button)label.style.justifyContent='center';
    label.textContent=value;
    label.setAttribute('data-import-form-text','true');
    element.replaceWith(label);
  }
  for(const element of Array.from(root.querySelectorAll('select'))){
    const select=element as HTMLSelectElement;
    if(select.multiple || select.size>1)continue;
    const option=select.options[select.selectedIndex];
    const computed=getComputedStyle(element);
    const label=copyBox(element);
    label.style.whiteSpace='pre';
    label.style.overflow='hidden';
    centerContent(label,computed);
    label.style.justifyContent='space-between';
    label.style.gap='8px';
    const text=document.createElement('span');
    text.textContent=(option?.textContent || '').trim() || '\u00a0';
    label.appendChild(text);
    if(computed.appearance!=='none' && (computed as any).webkitAppearance!=='none'){
      const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');
      arrow.setAttribute('width','10');arrow.setAttribute('height','6');arrow.setAttribute('viewBox','0 0 10 6');
      arrow.innerHTML='<path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
      label.appendChild(arrow);
    }
    label.setAttribute('data-import-form-text','true');
    element.replaceWith(label);
  }
}
