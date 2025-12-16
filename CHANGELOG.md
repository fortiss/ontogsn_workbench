# Changelog

All notable changes to this project will be documented in this file.

Note: our current approach only weakly adheres to the Semantic Versioning (SemVer) best practices. We will likely improve the versioning in the future.

## [0.2.0] - 2025-12-16

### Added
- Chat pane with correct wiring.
- Welcome pane.

### Changed
- Updated welcome.md.
- Auto-populated welcome pane with content.
- Placed external scripts into vendor folder.
- Improved link conversion & added doc.
- Placed buttons into table pane.
- Spin-off table pane into table.js.
- Working code display pane w/ examples.

### Fixed
- Issues with competing pane handling via converter and editor.
- Duplicate code.
- Converter errors.
- Small issues and documented in js/readme.
- Pane-button handling bug.

## [0.1.0] - 2025-12-05

This release covers the initial development of the application, from the first commit to a functional version with several key features.

## [0.0.4] - 2025-12-03

### Added
- A `LICENSE` file was added to the project.

### Changed
- The main `README.md` was improved.
- Further small improvements were made to documentation and naming conventions.

## [0.0.3] - 2025-11-29

### Added
- An editor pane (`editor.js`) was added, allowing users to view and edit data.
- A document view (`document.js`) was created, with the ability to show tooltips generated from SPARQL queries.
- Functionality to update the model based on checkbox interactions was added, using SPARQL `UPDATE` queries.
- Documentation was added to the root folder and many subfolders in the form of `README.md` files.

### Changed
- The folder structure was refactored for better organization, moving assets into an `assets` directory with `css`, `js`, `data`, and `images` subdirectories.
- The visualization was modified to better align with the GSN (Goal Structuring Notation) standard.
- The performance of the model visualization was improved.
- Pane naming procedures were refactored for consistency.
- A major refactoring effort was undertaken to improve the codebase.
- The styling was improved, and `test.css` was renamed to `app.css`.

### Fixed
- Issues with the legend and node visualization were resolved.

### Removed
- An unused "reset cache" button was removed from the UI.

## [0.0.2] - 2025-11-23

### Added
- A working 3D car model was integrated into the viewer.
- A JavaScript-based converter (`converter.js`) was created to handle `asce_ontogsn` data, although it was initially untested.

### Changed
- The integration of the 3D model was improved for better performance and user experience.
- The `car_model` branch was merged into `main` via a pull request.

## [0.0.1] - 2025-11-15

### Added
- `index.html` as the main entry point.
- Initial JavaScript files for handling the graph (`graph.js`), model (`model.js`), and UI panes (`panes.js`).
- CSS for styling the application (`app.css`, `graph.css`).
- A chat module (`chat.js`) was added for user interaction.
