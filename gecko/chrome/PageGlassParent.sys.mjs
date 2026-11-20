export class SonaPageGlassParent extends JSWindowActorParent {
  receiveMessage({ data }) {
    const browser = this.browsingContext.top.embedderElement;
    browser?.ownerGlobal.Sona?.pageGlassScroll(browser, data);
  }
}
