# 🕒 Visual Time Planner

A modern, responsive web application for visual time planning, task management, and personal analytics. Built with Vue 3, TypeScript, and Pinia, this project follows a professional composable/service architecture, inspired by applications like Google Calendar but tailored for personal productivity.

_(**Note**: You should replace the placeholder link above with a real screenshot of your running application!)_

---

## ✨ Key Features

### 1. Visual Weekly Planner

- **Full Week Overview**: View your schedule in a responsive, 7-day calendar grid.
- **Task Creation**: Click any time slot to create a new task with a title, duration, start time, and category.
- **Drag & Drop Interface**:
  - **Move Tasks**: Drag tasks to reschedule them to a new time or day.
  - **Resize Tasks**: Drag the top or bottom border of a task to intuitively adjust its start time or duration.
  - **15-Minute Snapping**: All drag and resize operations snap to 15-minute intervals for precision.
- **Mobile & Touch Support**: The entire drag-and-drop interface is fully supported on mobile and touch devices.

### 2. Task & Category Management

- **Task Templates**: Create reusable templates for common tasks to schedule them in one click.
- **Dynamic Category Management**:
  - Create custom categories with unique names and colors via a color picker.
  - Edit and delete existing categories.
  - **Data Integrity**: Deleting a category safely re-assigns all its associated tasks and templates to a default "Other" category, preventing data loss.

### 3. Advanced Analytics Dashboard

- **Interactive Filtering**: Filter your analytics by year and by view type (Monthly, Weekly, or Daily).
- **Dynamic Range Selection**:
  - When viewing by month, select a specific range of months.
  - When viewing by week, select a specific range of weeks.
- **Data-Driven Visualizations**:
  - **Time by Category**: A dynamic pie chart that updates based on your selected filters.
  - **Time Breakdown**: A bar chart that visualizes total hours per month, week, or day.
  - **Dominant Category Coloring**: Each bar in the breakdown chart is colored according to the category you spent the most time on during that period.
  - **Total Time per Task Type**: A persistent table showing the aggregate time spent on each task template.

### 4. Professional UI/UX

- **Responsive Design**: The application is designed to be fully usable on both desktop and mobile devices, with adaptive layouts for the calendar, modals, and navigation.
- **Non-Blocking Notifications**: User actions provide feedback through clean, non-intrusive toast notifications for success and error states.
- **Custom Confirmation Modals**: Destructive actions like deletion are protected by professional confirmation dialogs instead of jarring browser alerts.

---

## 🏗️ Architecture & Design Principles

This project is built with a focus on maintainability, scalability, and clean code, following a senior-level architectural pattern.

- **Composable/Service Architecture**:
  - **Components (`/src/components`)**: Handle the UI and user interaction. They are kept as lean as possible.
  - **Composables (`/src/composables`)**: Contain all reactive logic and state management hooks (`useTasks`, `useStats`). They act as the bridge between components and the data layer.
  - **Stores (`/src/stores`)**: [Pinia](https://pinia.vuejs.org/) stores (`taskStore`, `uiStore`) act as the single source of truth for all application state. They contain all business logic and data mutation actions.
  - **Services (`/src/services`)**: Abstract data persistence. Currently uses `localStorage`, but is designed to be easily swappable with an API service.
- **High Cohesion & Low Coupling**: Features are modular and encapsulated. For example, the entire drag-and-drop logic is contained in its own composable, and the confirmation dialog system is managed entirely by the UI store.
- **Type Safety**: Built with TypeScript from the ground up to ensure robust, error-free code.

---

## 🛠️ Tech Stack

- **Framework**: [Vue 3](https://vuejs.org/) (using Composition API and `<script setup>`)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **State Management**: [Pinia](https://pinia.vuejs.org/)
- **Date & Time**: [Day.js](https://day.js.org/)
- **Charting**: [Chart.js](https://www.chartjs.org/) (with the `vue-chartjs` wrapper)
- **Styling**: Plain CSS with CSS Variables.

---

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

You will need [Node.js](https://nodejs.org/en/) (**v16+**) and [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/) installed on your computer.

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/visual-time-planner.git
    cd visual-time-planner
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```
    or
    ```bash
    yarn install
    ```

### Running the Development Server

To run the app in development mode with hot-reloading:

```bash
npm run dev
```
