Time Planner API
This repository contains the backend API for the Visual Time Planner application. Built with .NET 8, ASP.NET Core, and Entity Framework Core, this API provides a robust, secure, and scalable foundation for user authentication, data persistence, and real-time collaboration.
The architecture follows modern best practices, including Clean Architecture principles, CQRS (Command Query Responsibility Segregation) with MediatR, and a feature-rich implementation of multi-tenancy for organizations.
✨ Key Features

1. Authentication & User Management
   A complete, secure, and modern authentication system built on ASP.NET Core Identity with a JWT + Refresh Token flow, ideal for Single-Page Applications (SPAs).
   Guest Mode & Data Migration: Users can use the application without an account, storing data locally. Upon registration, they have the option to seamlessly migrate all their local data (tasks, categories, templates) to their new server-side account in a single, atomic transaction.
   Secure Registration: New user registration with robust password requirements enforced by FluentValidation.
   Email Confirmation: New accounts must be verified via an email link before login is permitted, preventing spam and ensuring user validity.
   JWT Authentication: Secure, short-lived JWT access tokens for authorizing API requests.
   Refresh Token Rotation: Long-lived, secure refresh tokens are used to obtain new access tokens without requiring the user to log in again. Refresh tokens are automatically rotated upon use for enhanced security.
   Secure Password Reset: A full "Forgot Password" flow that allows users to securely reset their password via an email link.
   Secure Logout: An endpoint to invalidate the user's refresh token on the server, effectively logging them out of their session.
2. Personal Data Management (Single-User Features)
   All endpoints are protected and scoped to the authenticated user, ensuring complete data privacy.
   Category Management: Full CRUD (Create, Read, Update, Delete) operations for personal task categories. Deleting a category safely reassigns its tasks to a default "Other" category to prevent data loss.
   Task Template Management: Full CRUD for reusable task templates.
   Task Management: Full CRUD for personal tasks on the user's schedule. Includes business logic to prevent overlapping tasks.
   Tasks from Templates: Create new tasks on the schedule based on pre-defined templates.
3. Multi-Tenancy & Organizational Features
   A comprehensive feature set allowing users to create and collaborate in organizations.
   Roles & Permissions
   Tiered Role System: A robust three-tier role system within each organization:
   Owner (1 per Org): The creator and ultimate authority. Can delete the organization and transfer ownership.
   Admin (Many per Org): Can manage members, tasks, and settings.
   Member (Many per Org): Standard user with permissions to manage their own organization-related tasks.
   Policy-Based Authorization: All organization endpoints are secured with granular authorization checks to enforce role-based permissions (e.g., only an Owner can delete the organization).
   Onboarding & Membership
   Organization Creation: Users can create new organizations, automatically becoming the Owner.
   Dual Join Codes: Owners can manage two types of unique, expiring join codes for easy onboarding: one for new Members and one for new Admins.
   Email Invitation System: Admins/Owners can invite users directly via email with a secure, token-based, expiring link.
   Member Management: Admins/Owners can view all members, remove members, and promote/demote users between the Member and Admin roles.
   Leaving an Organization: Users can leave organizations. To preserve historical data, the membership is marked as "Left" rather than being deleted.
   Collaborative Task & Project Management
   Segregated Schedules: A clear distinction between a user's personal tasks (visible only to them) and organization tasks (visible to other members based on roles).
   Multi-User Task Assignment: A single task can be assigned to multiple members of an organization.
   Task Assignment Workflow: Admins/Owners can assign tasks to any member. Members can create and assign tasks to themselves.
   Issue Panel (Kanban-Style Backlog):
   Admins/Owners can create custom boards (panels) like "Backlog," "To Do," and "Bugs."
   Unscheduled work items (Issues) can be created and organized within these panels.
   Issues can be seamlessly promoted into scheduled, assigned tasks, moving them from the planning phase to the execution phase.
   Full CRUD and drag-and-drop support (via a "move" endpoint) for issues.
4. Real-Time Collaboration with SignalR
   Live Updates: The API is integrated with SignalR to provide real-time updates to all connected clients within an organization.
   Comprehensive Event Coverage: When one user performs an action (e.g., creates a task, moves an issue, renames a panel, updates their status), all other members of the organization receive an immediate notification, allowing their UI to update without a page refresh.
   Efficient & Secure: The SignalR hub uses JWT claims to efficiently and securely group user connections by organization, ensuring notifications are only sent to the relevant users.
5. Analytics & Reporting
   Organization-Wide Analytics: A powerful endpoint for Admins/Owners to get aggregated analytics for their organization within a specified date range, including:
   Total hours broken down by category.
   Total hours broken down by member.
   Member-Specific Analytics: An endpoint to drill down into the analytics for a single member, viewable by Admins/Owners or by the members themselves.
   🏗️ Architecture & Design
   .NET 8 / C# 12: Built on the latest version of the .NET platform.
   Clean Architecture: The solution is structured with a clear separation of concerns (Domain, Application, Infrastructure, Presentation).
   CQRS Pattern: Uses the MediatR library to separate commands (write operations) from queries (read operations), leading to clean, focused, and testable business logic.
   Entity Framework Core: Leverages EF Core for data access with a code-first approach. Includes advanced features like global query filters for soft deletes and a robust DbContext configuration using the Fluent API.
   FluentValidation: Provides automatic, expressive, and robust validation for all incoming API requests.
   Centralized Exception Handling: Custom middleware provides consistent and safe error responses.
   Dependency Injection: Extensively used throughout the application to promote loose coupling and testability.
   Serilog: Structured logging is configured for robust and queryable application logs.
   🚀 Getting Started
   Clone the repository.
   Configure secrets.json:
   Set your ConnectionStrings:DefaultConnection.
   Set your JwtSettings:Secret.
   Configure your email provider settings (PostmarkSettings).
   Apply Migrations: Run dotnet ef database update in the API project directory.
   Run the application: dotnet run. The API will be available with a Swagger UI for testing.
