# 🕒 Visual Time Planner - Backend API

This repository contains the backend API for the Visual Time Planner application. It is a modern, secure, and scalable ASP.NET 9 Web API built with a focus on clean architecture principles, robust authentication, and efficient data handling.

The API is designed to support the Vue.js frontend by providing services for user authentication, data persistence for tasks, categories, and templates, and business logic enforcement.

## ✨ Key Features & Capabilities

### 1\. Secure Authentication & User Management

- **JWT-Based Authentication**: Utilizes JSON Web Tokens (JWT) for stateless, secure communication with the frontend client.
- **Access & Refresh Tokens**: Implements a robust token rotation strategy with short-lived access tokens (15 mins) and long-lived refresh tokens (7 days) to enhance security and user experience.
- **Secure User Registration & Login**: Leverages ASP.NET Core Identity for battle-tested user management, including secure password hashing (PBKDF2).
- **Guest Data Migration**: A dedicated feature on the registration endpoint allows a guest user to seamlessly migrate their localStorage data to their new account in a single, transactional operation.

### 2\. Full CRUD Functionality

The API provides comprehensive, secure, and user-scoped Create, Read, Update, and Delete operations for all core application entities:

- **Categories**: Users can manage their own custom categories.
- **Task Templates**: Users can create and manage reusable templates for common tasks.
- **Tasks**: The core feature, allowing users to schedule, update, and delete their tasks.

### 3\. Business Logic Enforcement

The API is not just a simple data layer; it enforces critical business rules on the server-side to ensure data integrity:

- **Task Overlap Prevention**: The system automatically prevents users from creating or updating tasks that would overlap with existing ones.
- **Data Ownership & Security**: All data is strictly scoped to the authenticated user. It is impossible for one user to access or modify another user's data.
- **Referential Integrity**:

  - Prevents deletion of a category if it is linked to a task or template, reassigning them to a default "Other" category instead.
  - Ensures that tasks and templates can only be assigned to categories that exist and are owned by the user.

### 4\. Professional Architecture & Design

- **CQRS with MediatR**: Follows the Command Query Responsibility Segregation pattern. This separates read operations (Queries) from write operations (Commands), leading to a clean, highly cohesive, and scalable codebase.
- **FluentValidation**: Implements declarative, strongly-typed validation rules for all incoming requests, ensuring data is valid before it hits the business logic.
- **Entity Framework Core**: Utilizes EF Core with the Fluent API for precise control over the database schema, relationships, and constraints.
- **Dependency Injection**: Heavily uses DI to create a loosely coupled and highly testable system.-- **Global Exception Handling**: A centralized middleware handles all exceptions, providing consistent, clean error responses to the client without cluttering controller logic.

## 🛠️ Tech Stack

- **Framework**: [.NET 9](https://www.google.com/url?sa=E&q=https://dotnet.microsoft.com/en-us/download/dotnet/9.0)
- **Language**: C#
- **Web Framework**: ASP.NET Core
- **Data Access**: Entity Framework Core 9
- **Authentication**: ASP.NET Core Identity & JWT Bearer Tokens
- **API Design Pattern**: CQRS with MediatR
- **Validation**: FluentValidation
- **Database**: Microsoft SQL Server (or any other EF Core compatible database)

## 🚀 Getting Started

Follow these instructions to get the API up and running on your local machine for development and testing.

### Prerequisites

- [.NET 9 SDK](https://www.google.com/url?sa=E&q=https://dotnet.microsoft.com/en-us/download/dotnet/9.0)
- [SQL Server](https://www.google.com/url?sa=E&q=https://www.microsoft.com/en-us/sql-server/sql-server-downloads) (e.g., Express or Developer Edition) or another compatible database.
- A code editor like [Visual Studio Code](https://www.google.com/url?sa=E&q=https://code.visualstudio.com/) or Visual Studio.
- codeBashdotnet tool install --global dotnet-ef

### Installation & Setup

1.  codeBashgit clone https://github.com/your-username/visual-time-planner-api.gitcd visual-time-planner-api
2.  **Configure your database connection:**

    - Open the appsettings.json file.
    - Locate the ConnectionStrings section.
    - codeJson"DefaultConnection": "Server=(localdb)\\\\mssqllocaldb;Database=TimePlannerDb;Trusted_Connection=True;"

3.  **Configure JWT Settings:**

    - In appsettings.json, find the JwtSettings section.
    - codeJson"Secret": "YOUR_NEW_SUPER_SECRET_AND_LONG_KEY_HERE"

4.  codeBash# This creates the initial migration files based on the codedotnet ef migrations add InitialCreate# This applies the migration to your database, creating all tablesdotnet ef database update

    - The project uses EF Core Migrations to manage the database schema.
    - Open your terminal in the project's root directory and run the following commands:

### Running the Development Server

You can run the API in one of two ways:

#### Using the .NET CLI

This is the standard way to run the application from your terminal.

codeBash

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`dotnet run`

The API will start, and you will see output in your console indicating the URL it is listening on (e.g., https://localhost:7123).

#### Using Visual Studio Code

1.  Open the project folder in VS Code.
2.  Install the recommended **C# Dev Kit** extension.
3.  Press **F5** or go to the "Run and Debug" panel and click the green play button. This will launch the API with the debugger attached.

Once running, you can access the interactive **Swagger UI** to explore and test all the API endpoints by navigating to https://localhost:YOUR_PORT/swagger in your web browser.

## 🧪 API Endpoints & Testing with Swagger

The Swagger UI provides a complete, interactive documentation of the API. You can use it to test the entire authentication flow and all CRUD operations.

**Authentication Flow:**

1.  **Register a User**:

    - Expand the POST /api/auth/register endpoint.
    - Click "Try it out" and enter an email and a strong password.
    - Click "Execute". You will receive an accessToken and refreshToken in the response.

2.  **Authorize Your Session**:

    - At the top right of the Swagger page, click the "Authorize" button.
    - In the dialog, type Bearer (with a space at the end) and paste your accessToken.
    - Click "Authorize". All subsequent requests from the Swagger UI will now include this token.

3.  **Test a Protected Endpoint**:

    - Expand GET /api/categories.
    - Click "Try it out", then "Execute".
    - You should now receive a 200 OK response with an empty array, as you have successfully accessed a protected endpoint.
