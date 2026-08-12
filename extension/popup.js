const toggle = document.getElementById("toggle");
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const title = document.getElementById("title");
const artist = document.getElementById("artist");

function render(status) {
  if (!status) {
    dot.className = "dot";
    statusText.textContent = "Extension not responding";
    return;
  }

  toggle.checked = status.enabled;

  if (!status.enabled) {
    dot.className = "dot";
    statusText.textContent = "Turned off";
  } else if (status.connected) {
    dot.className = "dot on";
    statusText.textContent = "Connected to presence server";
  } else {
    dot.className = "dot off";
    statusText.textContent = "Server not running";
  }

  if (status.track?.title) {
    title.textContent = status.track.title;
    title.classList.remove("muted");
    artist.textContent = status.track.paused ? `${status.track.artist} — paused` : status.track.artist;
  } else {
    title.textContent = "Nothing playing";
    title.classList.add("muted");
    artist.textContent = "";
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (res) => {
    if (chrome.runtime.lastError) return render(null);
    render(res);
  });
}

toggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "setEnabled", value: toggle.checked }, () => {
    if (chrome.runtime.lastError) return;
    setTimeout(refresh, 300);
  });
});

refresh();
setInterval(refresh, 1500);
