import { document, getComputedStyle } from '../environment';

// Input values and placeholders aren't DOM text nodes. Materialize a static
// label at the same computed box so the normal text parser can import it.
export function materializeFormLabels(root: Element) {
  for(const element of Array.from(root.querySelectorAll('input,textarea'))){
    const control=element as HTMLInputElement | HTMLTextAreaElement;
    const type=(element.getAttribute('type') || 'text').toLowerCase();
    if(!['text','email','search','url','tel','number','password'].includes(type) && element.tagName.toLowerCase()!=='textarea')continue;
    let value=control.value || control.getAttribute('value') || '';
    const placeholder=!value;
    value=value || control.getAttribute('placeholder') || '';
    if(!value)continue;
    if(type==='password' && !placeholder)value='•'.repeat(value.length);
    const computed=getComputedStyle(element);
    const label=document.createElement('div');
    for(let i=0;i<computed.length;i++){
      const property=computed.item(i);
      label.style.setProperty(property,computed.getPropertyValue(property));
    }
    if(placeholder){
      const pseudo=getComputedStyle(element,'::placeholder');
      label.style.color=pseudo.color || computed.color;
      label.style.opacity=pseudo.opacity || computed.opacity;
    }
    label.style.whiteSpace=element.tagName.toLowerCase()==='textarea'?'pre-wrap':'pre';
    label.style.overflow='hidden';
    label.textContent=value;
    label.setAttribute('data-import-form-text','true');
    element.replaceWith(label);
  }
}
