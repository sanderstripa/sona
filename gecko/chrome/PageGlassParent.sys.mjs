export class SonaPageGlassParent extends JSWindowActorParent {
  receiveMessage({ data }) {
    const browser = this.browsingContext.top.embedderElement;
    if (browser?.browsingContext.currentWindowGlobal === this.manager) {
      browser.ownerDocument.defaultView.Sona?.pageGlassScroll(browser, data);
    }
  }
}
