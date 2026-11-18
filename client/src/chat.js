// Chat texte : Entrée ouvre la saisie, Entrée envoie, Échap annule.
// Les messages s'effacent après quelques secondes ; quand la saisie est ouverte on revoit l'historique récent.
const SHOW_SECONDS = 10;
const KEEP = 50;

export class Chat {
  constructor(onSend) {
    this.root = document.getElementById('chat');
    this.log = document.getElementById('chat-log');
    this.form = document.getElementById('chat-form');
    this.input = document.getElementById('chat-input');
    this.onSend = onSend;
    this.isOpen = false;

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text) this.onSend(text);
      this.close();
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // la frappe ne pilote pas le char et n'ouvre pas le menu
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('blur', () => this.close());
  }

  setVisible(on) {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.close();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.form.classList.remove('hidden');
    this.input.value = '';
    this.input.focus();
    this.log.scrollTop = this.log.scrollHeight;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.form.classList.add('hidden');
    this.input.value = '';
    this.input.blur();
    this.log.scrollTop = this.log.scrollHeight;
  }

  // team : 'red' | 'blue' | null (spectateur) ; system : message d'information (sans auteur)
  add({ name, team, text, system = false }) {
    const row = document.createElement('div');
    row.className = system ? 'sys' : '';
    if (!system) {
      const who = document.createElement('b');
      who.className = team ? `c-${team}` : 'c-spec';
      who.textContent = `${name} :`;
      row.append(who, ' ');
    }
    row.append(text);
    this.log.append(row);
    setTimeout(() => row.classList.add('old'), SHOW_SECONDS * 1000);
    while (this.log.children.length > KEEP) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
