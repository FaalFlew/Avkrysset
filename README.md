
### Live version can be found at https://avkrysset.no The application is hosted on Azure with cold starts.

# Task & Schedule Management Platform

A fullstack application for personal and organizational task management, built with **Vue.js**, **ASP.NET Core**, and **MS SQL**.  
The platform supports personal scheduling, multi-tenant organizations with RBAC. The code architecture is written with a focus on maintainability and scalability.

---

## Project Overview

This system provides:
- Personal and organizational task management
- Role-based permissions (Owner, Admin, Member)
- Multi-tenancy with data separation.
- Personal and organizational analytics.
- A backend built on Vertical Slice Architecture, CQRS, and Clean Architecture principles.

## | Features

### || Frontend
- **Weekly Planner**: 7-day calendar grid with drag and drop, and rresizing tasks.
- **Tasks & Categories**: Create tasks, reusable templates, and categories.
- **Analytics Dashboard**: Filter by year, month, week, or day. Includes pie charts, bar charts, a task summary table.
- **Feedback**: toast notifications, and confirmation dialogs.

### || Backend
- **Authentication**: JWT based with access/refresh tokens. secure registration, login, and guest data migration.
- **CRUD Operations**: Manage categories, task templates, and tasks (scoped per user).
- **Business Rules**: Prevents overlapping tasks, enforces ownership, reassigns deleted categories safely.

---

## Architecture

- **Frontend (Vue 3 + TypeScript)**
  - Components → UI and interaction
  - Composables → state logic
  - Pinia stores → global state and actions
  - Services → persistence (localStorage and API)

- **Backend (ASP.NET 9 + C#)**  
## Backend Architecture

The backend follows a mix of **Vertical Slice Architecture** with **CQRS**, and **Clean Architecture** to keep the codebase maintainable, testable, and easy to extend.

### 1. Vertical Slice Architecture
- Code is organized by **feature**, not by technical layer.
- Each feature folder contains everything it needs: commands, queries, handlers, validation, and business logic.
- This makes features easy to find and update without touching unrelated files.

### 2. CQRS with MediatR
- Every request is a **Command** or a **Query**.
- Controllers stay thin: they convert HTTP requests into commands/queries and dispatch them with MediatR.
- Handlers are small, focused classes with a single responsibility.
- Separating reads and writes makes the system easier to scale, with room for caching or optimized read models in the future.

### 3. Clean Architecture Principles
- Follows the **Dependency Rule**: dependencies point inward toward the core.
- **Core**: business logic and domain entities (handlers + models).
- **Outer layers**: ASP.NET controllers, EF Core, and external services. These depend on the core, but not vice versa.
- This separation makes the core logic highly testable and portable. For example EF Core could be swapped for another data layer, or the REST API could be replaced by gRPC, without changing the core business code.


---
## Role-Based Access Control (RBAC) & Multi-Tenancy

The backend includes a multi-tenant RBAC system to manage users, roles, tasks within organizations.

### 1. Multi-Tenancy Model
- **Organizations**: Each organization is a container for members, admins, and tasks.
- **Memberships**: Users join organizations through `OrganizationMembership` entries.
- **Tasks**: A single `TaskItem` entity supports both personal and organization tasks (via a nullable `OrganizationId`).

### 2. Roles
- **Owner**: One per organization. Full control, including deleting the organization, regenerating join codes, and transferring ownership.
- **Admin**: Can manage members, assign tasks, manage settings, and view analytics.
- **Member**: Can create tasks for themselves and view/complete tasks assigned to them.

### 3. Join Codes
- **Member Code**: Grants the Member role when used to join.
- **Admin Code**: Grants the Admin role when used to join.
- **Expiration**: Controlled by the Owner, codes can be regenerated and are only visible to the Owner.

### 4. Permissions
- **Owner/Admins**:  
  - Invite/remove members, promote/demote admins.
  - Assign tasks to members (tasks can be assigned to multiple members).
  - View all organization tasks and analytics.
  - Manage organization settings.
  - Create organization-wide issues in the Issue Panel.
- **Members**:  
  - Create personal or organization tasks for themselves.
  - Cannot decline or reassign tasks assigned by Owner/Admins.
- **Owner Only**:  
  - Transfer ownership.
  - Delete the organization

### 5. Membership Status
- **Active**: Regular member.
- **Left**: User left or was removed; tasks remain visible but user no longer participates.
- **Deleted**: If an Owner/Admin explicitly chooses to delete a member’s tasks, both the user (in org context) and their tasks are removed

### 6. Organization Issues Panel
- A collaborative space for tracking unscheduled work.
- **Tables**: Each panel has named tables (e.g., "Auth Issues").
- **Issues**: Contain fields like Title, Notes, Category.
- **Conversion**: Issues can be converted into assignable tasks with a start date, duration, and assignees

### 7. Authorization Strategy
- **Global Roles** (via ASP.NET Identity): e.g., `SuperAdmin`.
- **Contextual Roles** (via Claims/Policies): Users receive claims for each organization they belong to, e.g.:
  ```json
  {
    "organizationId": "ORG_GUID_1",
    "organizationRole": "OrganizationAdmin"
  }

---

## Tech Stack

**Frontend**  
- [Vue 3](https://vuejs.org/) with Composition API
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [Pinia](https://pinia.vuejs.org/)
- [Day.js](https://day.js.org/)
- [Chart.js](https://www.chartjs.org/) + `vue-chartjs`
- CSS with variables

**Backend**  
- [.NET 9](https://dotnet.microsoft.com/en-us/download/dotnet/9.0)
- ASP.NET Core Web API
- Entity Framework Core 9
- ASP.NET Identity + JWT
- CQRS with MediatR
- FluentValidation
- SQL Server (or any EF Core-compatible database)

---
