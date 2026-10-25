(() => {
  if (document.getElementById("amora-chat-launcher")) return;
  const launcher = document.createElement("button");
  launcher.id = "amora-chat-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open quick chats");
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML = '<span aria-hidden="true">♡</span><span class="amora-chat-launcher-label">Chats</span>';
  const panel = document.createElement("section");
  panel.id = "amora-chat-popup";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Quick chats");
  panel.innerHTML = '<header class="amora-chat-popup-head"><div><strong>Amora chats</strong><small>Private conversations</small></div><div class="amora-chat-popup-actions"><a href="/pages/messages.html" aria-label="Open full messages page" title="Open full messages">↗</a><button type="button" data-chat-minimize aria-label="Minimize chats">−</button><button type="button" data-chat-close aria-label="Close chats">×</button></div></header><iframe title="Amora quick chat" src="/pages/messages.html?popup=1" loading="lazy"></iframe>';
  document.body.append(launcher, panel);
  const close = () => { panel.hidden = true; launcher.setAttribute("aria-expanded", "false"); };
  launcher.addEventListener("click", () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    launcher.setAttribute("aria-expanded", String(opening));
  });
  panel.querySelector("[data-chat-close]").addEventListener("click", close);
  panel.querySelector("[data-chat-minimize]").addEventListener("click", close);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden) close(); });
})();