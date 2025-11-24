# WORK IN PROGESS - Khiops Visualization Desktop

![Build Releases](https://github.com/KhiopsML/khiops-visualization-desktop/actions/workflows/release.yml/badge.svg) ![Test Workflow](https://github.com/KhiopsML/khiops-visualization/actions/workflows/test.yml/badge.svg) [![Latest Stable Version](https://img.shields.io/github/v/release/KhiopsML/khiops-visualization-desktop?label=Latest%20stable%20version)](https://github.com/KhiopsML/khiops-visualization-desktop/releases) [![End-to-end tests](https://github.com/KhiopsML/khiops-visualization/actions/workflows/e2e.yml/badge.svg)](https://github.com/KhiopsML/khiops-visualization/actions/workflows/e2e.yml) ![gitleaks badge](https://img.shields.io/badge/protected%20by-gitleaks-blue)

**Khiops Visualization Desktop** is a cross-platform application designed to make machine learning on structured data easier, faster, and more intuitive. It provides a native interface for exploring, analyzing, and interpreting the results of Khiops’ advanced AutoML algorithms.

<img width="791" height="546" alt="image" src="https://github.com/user-attachments/assets/c1adabec-555f-4e72-9465-94c3e69aceaf" />

This Electron application integrates [Khiops visualization](https://github.com/KhiopsML/khiops-visualization) into a native desktop interface. It enables users to intuitively and efficiently analyze and visualize machine learning data.

## 📋 Table of Contents

- [About](#-about)
- [Features](#-features)
- [Downloads](#-downloads)
- [Build and Distribution](#-build-and-distribution)
- [Project Structure](#-project-structure)
- [Technologies Used](#️-technologies-used)
- [Contributing](#-contributing)
- [License](#-license)

## 🎯 About

Historically, these were distributed as two distinct desktop apps. Now, their features and codebases have been unified into this single application.

For reference, you can find the old releases here:

- [khiops-visualization releases](https://github.com/KhiopsML/kv-electron/releases)
- [khiops-covisualisation releases](https://github.com/KhiopsML/kc-electron/releases)

The project is based on the [angular-electron](https://github.com/maximegris/angular-electron) template and uses Angular with TypeScript for the user interface.

## ✨ Features

- 🖥️ **Cross-platform native application** (Windows, macOS, Linux)
- 📊 **Advanced visualization** of Khiops data and models
- 🔄 **Automatic updates** with electron-updater
- 🎨 **Modern interface** built with Angular and Electron
- 🔧 **Development mode** with hot-reload
- 📦 **Automated builds** via GitHub Actions

## ⬇️ Downloads

You can download the latest version of Khiops Visualization Desktop for Windows, macOS, and Linux from the [Releases page](https://github.com/KhiopsML/khiops-visualization-desktop/releases).

## 📦 Build and Distribution

### Local build

```bash
yarn build
```

### Generating installers

Distribution builds are automatically generated via GitHub Actions on release. Artifacts are available in the `release/` folder:

- **Windows**: `khiops visualization Setup [version].exe`
- **macOS**: Support with entitlements and code signing
- **Linux**: AppImage and other formats

## 📁 Project Structure

```text
khiops-visualization-desktop/
├── app/                           # Main Electron application
│   ├── main.ts                    # Electron entry point
│   └── package.json               # Electron dependencies
├── src/                           # Angular source code
│   ├── app/                       # Angular modules and components
│   ├── assets/                    # Static resources
│   └── environments/              # Environment configuration
├── build/                         # Build resources
├── scripts/                       # Build and deployment scripts
└── release/                       # Distribution artifacts
```

## 🛠️ Technologies Used

- **Electron** – Framework for cross-platform desktop apps
- **Angular** – Web framework for the UI
- **TypeScript** – Typed programming language
- **Node.js** – JavaScript runtime
- **Yarn** – Package manager
- **electron-updater** – Automatic update system
- **Matomo** – Optional usage analytics

## 🤝 Contributing

Contributions are welcome! Here's how to contribute:

### Getting Started

#### 1. Clone the repository

```bash
git clone https://github.com/KhiopsML/khiops-visualization-desktop.git
cd khiops-visualization-desktop
```

#### 2. Install dependencies

```bash
yarn install
```

### Development Setup

#### Start in standard development mode

To start the application in development mode:

```bash
yarn start
```

#### Develop with local visualization component

To develop with a local version of the visualization component:

```bash
yarn dev
```

This command:

- Replaces the visualization library with the local copy
- Uses scripts from the `../visualization-component/dist/khiops-webcomponent/` directory
- Enables hot-reload for rapid development

### Contributing Your Changes

1. **Fork** the project
2. **Create** a branch for your feature (`git checkout -b feature/new-feature`)
3. **Commit** your changes (`git commit -m 'Add new feature'`)
4. **Push** to the branch (`git push origin feature/new-feature`)
5. **Open** a Pull Request

## 📄 License

This project is licensed under the BSD 3-Clause-clear license. See the [LICENSE](LICENSE) file for more details.

## 🔗 Useful Links

- [Khiops Visualization Repository](https://github.com/KhiopsML/khiops-visualization)
- [Releases](https://github.com/KhiopsML/khiops-visualization-desktop/releases)
- [Issues](https://github.com/KhiopsML/khiops-visualization-desktop/issues)
- [Khiops Documentation](https://khiops.org)
- [Boilerplate change log](https://github.com/maximegris/angular-electron/blob/master/CHANGELOG.md)
