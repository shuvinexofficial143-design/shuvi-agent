const { entrypoints } = require("uxp");
const premiere = require("premierepro");

function show(value) {
  const output = document.getElementById("output");
  if (output) output.textContent = value;
}

async function inspectActiveContext() {
  try {
    const project = await premiere.Project.getActiveProject();

    if (!project) {
      show("No active Premiere project.");
      return;
    }

    const sequence = await project.getActiveSequence();

    const context = {
      projectDetected: true,
      projectName: project.name || null,
      sequenceDetected: Boolean(sequence),
      sequenceName: sequence && sequence.name ? sequence.name : null
    };

    show(JSON.stringify(context, null, 2));
  } catch (error) {
    show("Premiere inspection failed: " + String(error));
  }
}

entrypoints.setup({
  panels: {
    "shuvi-premiere-panel": {
      create() {
        const button = document.getElementById("inspect");
        if (button) button.addEventListener("click", () => void inspectActiveContext());
      },
      show() {
        void inspectActiveContext();
      }
    }
  }
});
