IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetRoles] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(256) NULL,
        [NormalizedName] nvarchar(256) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoles] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUsers] (
        [Id] uniqueidentifier NOT NULL,
        [RefreshToken] nvarchar(max) NULL,
        [RefreshTokenExpiryTime] datetime2 NOT NULL,
        [UserName] nvarchar(256) NULL,
        [NormalizedUserName] nvarchar(256) NULL,
        [Email] nvarchar(256) NULL,
        [NormalizedEmail] nvarchar(256) NULL,
        [EmailConfirmed] bit NOT NULL,
        [PasswordHash] nvarchar(max) NULL,
        [SecurityStamp] nvarchar(max) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        [PhoneNumber] nvarchar(max) NULL,
        [PhoneNumberConfirmed] bit NOT NULL,
        [TwoFactorEnabled] bit NOT NULL,
        [LockoutEnd] datetimeoffset NULL,
        [LockoutEnabled] bit NOT NULL,
        [AccessFailedCount] int NOT NULL,
        CONSTRAINT [PK_AspNetUsers] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetRoleClaims] (
        [Id] int NOT NULL IDENTITY,
        [RoleId] uniqueidentifier NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoleClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetRoleClaims_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserClaims] (
        [Id] int NOT NULL IDENTITY,
        [UserId] uniqueidentifier NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetUserClaims_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserLogins] (
        [LoginProvider] nvarchar(450) NOT NULL,
        [ProviderKey] nvarchar(450) NOT NULL,
        [ProviderDisplayName] nvarchar(max) NULL,
        [UserId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_AspNetUserLogins] PRIMARY KEY ([LoginProvider], [ProviderKey]),
        CONSTRAINT [FK_AspNetUserLogins_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserRoles] (
        [UserId] uniqueidentifier NOT NULL,
        [RoleId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_AspNetUserRoles] PRIMARY KEY ([UserId], [RoleId]),
        CONSTRAINT [FK_AspNetUserRoles_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_AspNetUserRoles_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserTokens] (
        [UserId] uniqueidentifier NOT NULL,
        [LoginProvider] nvarchar(450) NOT NULL,
        [Name] nvarchar(450) NOT NULL,
        [Value] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserTokens] PRIMARY KEY ([UserId], [LoginProvider], [Name]),
        CONSTRAINT [FK_AspNetUserTokens_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [Categories] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(100) NOT NULL,
        [Color] nvarchar(7) NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_Categories] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Categories_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [Tasks] (
        [Id] uniqueidentifier NOT NULL,
        [Title] nvarchar(200) NOT NULL,
        [Start] datetime2 NOT NULL,
        [Duration] float NOT NULL,
        [CategoryId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [TemplateId] uniqueidentifier NULL,
        CONSTRAINT [PK_Tasks] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Tasks_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_Tasks_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [Categories] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE TABLE [TaskTemplates] (
        [Id] uniqueidentifier NOT NULL,
        [Title] nvarchar(200) NOT NULL,
        [Duration] float NOT NULL,
        [CategoryId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_TaskTemplates] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_TaskTemplates_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_TaskTemplates_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [Categories] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetRoleClaims_RoleId] ON [AspNetRoleClaims] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [RoleNameIndex] ON [AspNetRoles] ([NormalizedName]) WHERE [NormalizedName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetUserClaims_UserId] ON [AspNetUserClaims] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetUserLogins_UserId] ON [AspNetUserLogins] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetUserRoles_RoleId] ON [AspNetUserRoles] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [EmailIndex] ON [AspNetUsers] ([NormalizedEmail]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UserNameIndex] ON [AspNetUsers] ([NormalizedUserName]) WHERE [NormalizedUserName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Categories_UserId_Name] ON [Categories] ([UserId], [Name]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Tasks_CategoryId] ON [Tasks] ([CategoryId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Tasks_UserId] ON [Tasks] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_TaskTemplates_CategoryId] ON [TaskTemplates] ([CategoryId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_TaskTemplates_UserId] ON [TaskTemplates] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809123935_InitialCreate'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250809123935_InitialCreate', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250809152827_MigrationNameUpdatedForTest'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250809152827_MigrationNameUpdatedForTest', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [CreatedByUserId] uniqueidentifier NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [CreatedOnUtc] datetime2 NOT NULL DEFAULT '0001-01-01T00:00:00.0000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [DeletedByUserId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [DeletedOnUtc] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [IsDeleted] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [UpdatedByUserId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD [UpdatedOnUtc] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Tasks] ADD [CreatedByUserId] uniqueidentifier NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Tasks] ADD [CreatedOnUtc] datetime2 NOT NULL DEFAULT '0001-01-01T00:00:00.0000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Tasks] ADD [DeletedByUserId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Tasks] ADD [DeletedOnUtc] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Tasks] ADD [IsDeleted] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Tasks] ADD [UpdatedByUserId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Tasks] ADD [UpdatedOnUtc] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Categories] ADD [CreatedByUserId] uniqueidentifier NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Categories] ADD [CreatedOnUtc] datetime2 NOT NULL DEFAULT '0001-01-01T00:00:00.0000000';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Categories] ADD [DeletedByUserId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Categories] ADD [DeletedOnUtc] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Categories] ADD [IsDeleted] bit NOT NULL DEFAULT CAST(0 AS bit);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Categories] ADD [UpdatedByUserId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    ALTER TABLE [Categories] ADD [UpdatedOnUtc] datetime2 NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250810090616_Add_Auditing_And_SoftDelete'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250810090616_Add_Auditing_And_SoftDelete', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    ALTER TABLE [Tasks] DROP CONSTRAINT [FK_Tasks_Categories_CategoryId];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    ALTER TABLE [TaskTemplates] DROP CONSTRAINT [FK_TaskTemplates_Categories_CategoryId];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE TABLE [Organizations] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(150) NOT NULL,
        [OwnerId] uniqueidentifier NOT NULL,
        [MemberJoinCode] nvarchar(8) NOT NULL,
        [MemberJoinCodeExpiryUtc] datetime2 NOT NULL,
        [AdminJoinCode] nvarchar(8) NOT NULL,
        [AdminJoinCodeExpiryUtc] datetime2 NOT NULL,
        [CreatedOnUtc] datetime2 NOT NULL,
        [CreatedByUserId] uniqueidentifier NOT NULL,
        [UpdatedOnUtc] datetime2 NULL,
        [UpdatedByUserId] uniqueidentifier NULL,
        [IsDeleted] bit NOT NULL,
        [DeletedOnUtc] datetime2 NULL,
        [DeletedByUserId] uniqueidentifier NULL,
        CONSTRAINT [PK_Organizations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Organizations_AspNetUsers_OwnerId] FOREIGN KEY ([OwnerId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE TABLE [OrganizationMemberships] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [OrganizationId] uniqueidentifier NOT NULL,
        [Role] nvarchar(max) NOT NULL,
        [Status] nvarchar(max) NOT NULL,
        [CreatedOnUtc] datetime2 NOT NULL,
        [CreatedByUserId] uniqueidentifier NOT NULL,
        [UpdatedOnUtc] datetime2 NULL,
        [UpdatedByUserId] uniqueidentifier NULL,
        [IsDeleted] bit NOT NULL,
        [DeletedOnUtc] datetime2 NULL,
        [DeletedByUserId] uniqueidentifier NULL,
        CONSTRAINT [PK_OrganizationMemberships] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_OrganizationMemberships_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_OrganizationMemberships_Organizations_OrganizationId] FOREIGN KEY ([OrganizationId]) REFERENCES [Organizations] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE UNIQUE INDEX [IX_OrganizationMemberships_OrganizationId_UserId] ON [OrganizationMemberships] ([OrganizationId], [UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE INDEX [IX_OrganizationMemberships_UserId] ON [OrganizationMemberships] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Organizations_AdminJoinCode] ON [Organizations] ([AdminJoinCode]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Organizations_MemberJoinCode] ON [Organizations] ([MemberJoinCode]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Organizations_Name] ON [Organizations] ([Name]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    CREATE INDEX [IX_Organizations_OwnerId] ON [Organizations] ([OwnerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    ALTER TABLE [Tasks] ADD CONSTRAINT [FK_Tasks_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [Categories] ([Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    ALTER TABLE [TaskTemplates] ADD CONSTRAINT [FK_TaskTemplates_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [Categories] ([Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250828210331_AddOrganizationEntities'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250828210331_AddOrganizationEntities', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829105132_AddOrganizationTasks'
)
BEGIN
    ALTER TABLE [Tasks] ADD [OrganizationId] uniqueidentifier NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829105132_AddOrganizationTasks'
)
BEGIN
    CREATE TABLE [TaskAssignments] (
        [Id] uniqueidentifier NOT NULL,
        [TaskItemId] uniqueidentifier NOT NULL,
        [AssigneeId] uniqueidentifier NOT NULL,
        [CreatedOnUtc] datetime2 NOT NULL,
        [CreatedByUserId] uniqueidentifier NOT NULL,
        [UpdatedOnUtc] datetime2 NULL,
        [UpdatedByUserId] uniqueidentifier NULL,
        [IsDeleted] bit NOT NULL,
        [DeletedOnUtc] datetime2 NULL,
        [DeletedByUserId] uniqueidentifier NULL,
        CONSTRAINT [PK_TaskAssignments] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_TaskAssignments_AspNetUsers_AssigneeId] FOREIGN KEY ([AssigneeId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_TaskAssignments_Tasks_TaskItemId] FOREIGN KEY ([TaskItemId]) REFERENCES [Tasks] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829105132_AddOrganizationTasks'
)
BEGIN
    CREATE INDEX [IX_Tasks_OrganizationId] ON [Tasks] ([OrganizationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829105132_AddOrganizationTasks'
)
BEGIN
    CREATE INDEX [IX_TaskAssignments_AssigneeId] ON [TaskAssignments] ([AssigneeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829105132_AddOrganizationTasks'
)
BEGIN
    CREATE UNIQUE INDEX [IX_TaskAssignments_TaskItemId_AssigneeId] ON [TaskAssignments] ([TaskItemId], [AssigneeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829105132_AddOrganizationTasks'
)
BEGIN
    ALTER TABLE [Tasks] ADD CONSTRAINT [FK_Tasks_Organizations_OrganizationId] FOREIGN KEY ([OrganizationId]) REFERENCES [Organizations] ([Id]) ON DELETE CASCADE;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829105132_AddOrganizationTasks'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250829105132_AddOrganizationTasks', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829143104_AddIssuePanelEntities'
)
BEGIN
    CREATE TABLE [IssuePanels] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(100) NOT NULL,
        [OrganizationId] uniqueidentifier NOT NULL,
        [CreatedOnUtc] datetime2 NOT NULL,
        [CreatedByUserId] uniqueidentifier NOT NULL,
        [UpdatedOnUtc] datetime2 NULL,
        [UpdatedByUserId] uniqueidentifier NULL,
        [IsDeleted] bit NOT NULL,
        [DeletedOnUtc] datetime2 NULL,
        [DeletedByUserId] uniqueidentifier NULL,
        CONSTRAINT [PK_IssuePanels] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_IssuePanels_Organizations_OrganizationId] FOREIGN KEY ([OrganizationId]) REFERENCES [Organizations] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829143104_AddIssuePanelEntities'
)
BEGIN
    CREATE TABLE [Issues] (
        [Id] uniqueidentifier NOT NULL,
        [Title] nvarchar(200) NOT NULL,
        [Notes] nvarchar(max) NULL,
        [CategoryId] uniqueidentifier NOT NULL,
        [OrganizationId] uniqueidentifier NOT NULL,
        [IssuePanelId] uniqueidentifier NOT NULL,
        [ConvertedToTaskItemId] uniqueidentifier NULL,
        [CreatedOnUtc] datetime2 NOT NULL,
        [CreatedByUserId] uniqueidentifier NOT NULL,
        [UpdatedOnUtc] datetime2 NULL,
        [UpdatedByUserId] uniqueidentifier NULL,
        [IsDeleted] bit NOT NULL,
        [DeletedOnUtc] datetime2 NULL,
        [DeletedByUserId] uniqueidentifier NULL,
        CONSTRAINT [PK_Issues] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Issues_Categories_CategoryId] FOREIGN KEY ([CategoryId]) REFERENCES [Categories] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Issues_IssuePanels_IssuePanelId] FOREIGN KEY ([IssuePanelId]) REFERENCES [IssuePanels] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_Issues_Organizations_OrganizationId] FOREIGN KEY ([OrganizationId]) REFERENCES [Organizations] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829143104_AddIssuePanelEntities'
)
BEGIN
    CREATE UNIQUE INDEX [IX_IssuePanels_OrganizationId_Name] ON [IssuePanels] ([OrganizationId], [Name]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829143104_AddIssuePanelEntities'
)
BEGIN
    CREATE INDEX [IX_Issues_CategoryId] ON [Issues] ([CategoryId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829143104_AddIssuePanelEntities'
)
BEGIN
    CREATE INDEX [IX_Issues_IssuePanelId] ON [Issues] ([IssuePanelId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829143104_AddIssuePanelEntities'
)
BEGIN
    CREATE INDEX [IX_Issues_OrganizationId] ON [Issues] ([OrganizationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250829143104_AddIssuePanelEntities'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250829143104_AddIssuePanelEntities', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250908214141_newDBOrgModels'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250908214141_newDBOrgModels', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909145917_AddStatusMessageToMembership'
)
BEGIN
    ALTER TABLE [OrganizationMemberships] ADD [StatusMessage] nvarchar(max) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909145917_AddStatusMessageToMembership'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250909145917_AddStatusMessageToMembership', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909171951_AddOrganizationInvitations'
)
BEGIN
    CREATE TABLE [OrganizationInvitations] (
        [Id] uniqueidentifier NOT NULL,
        [OrganizationId] uniqueidentifier NOT NULL,
        [InviterId] uniqueidentifier NOT NULL,
        [InvitedUserEmail] nvarchar(450) NOT NULL,
        [Role] nvarchar(max) NOT NULL,
        [Status] nvarchar(450) NOT NULL,
        [Token] nvarchar(450) NOT NULL,
        [ExpiryUtc] datetime2 NOT NULL,
        [CreatedOnUtc] datetime2 NOT NULL,
        [CreatedByUserId] uniqueidentifier NOT NULL,
        [UpdatedOnUtc] datetime2 NULL,
        [UpdatedByUserId] uniqueidentifier NULL,
        [IsDeleted] bit NOT NULL,
        [DeletedOnUtc] datetime2 NULL,
        [DeletedByUserId] uniqueidentifier NULL,
        CONSTRAINT [PK_OrganizationInvitations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_OrganizationInvitations_AspNetUsers_InviterId] FOREIGN KEY ([InviterId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_OrganizationInvitations_Organizations_OrganizationId] FOREIGN KEY ([OrganizationId]) REFERENCES [Organizations] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909171951_AddOrganizationInvitations'
)
BEGIN
    CREATE INDEX [IX_OrganizationInvitations_InviterId] ON [OrganizationInvitations] ([InviterId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909171951_AddOrganizationInvitations'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_OrganizationInvitations_OrganizationId_InvitedUserEmail_Status] ON [OrganizationInvitations] ([OrganizationId], [InvitedUserEmail], [Status]) WHERE [Status] = ''Pending''');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909171951_AddOrganizationInvitations'
)
BEGIN
    CREATE UNIQUE INDEX [IX_OrganizationInvitations_Token] ON [OrganizationInvitations] ([Token]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909171951_AddOrganizationInvitations'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250909171951_AddOrganizationInvitations', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909175815_AddOrganizationInvitationsAnnotations'
)
BEGIN
    DROP INDEX [IX_OrganizationInvitations_OrganizationId_InvitedUserEmail_Status] ON [OrganizationInvitations];
    DECLARE @var sysname;
    SELECT @var = [d].[name]
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[OrganizationInvitations]') AND [c].[name] = N'InvitedUserEmail');
    IF @var IS NOT NULL EXEC(N'ALTER TABLE [OrganizationInvitations] DROP CONSTRAINT [' + @var + '];');
    ALTER TABLE [OrganizationInvitations] ALTER COLUMN [InvitedUserEmail] nvarchar(256) NOT NULL;
    EXEC(N'CREATE UNIQUE INDEX [IX_OrganizationInvitations_OrganizationId_InvitedUserEmail_Status] ON [OrganizationInvitations] ([OrganizationId], [InvitedUserEmail], [Status]) WHERE [Status] = ''Pending''');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20250909175815_AddOrganizationInvitationsAnnotations'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20250909175815_AddOrganizationInvitationsAnnotations', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260421205800_RemoveTitleLengthLimit'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260421205800_RemoveTitleLengthLimit', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260421205936_RemoveTitleLengthLimite'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260421205936_RemoveTitleLengthLimite', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260421214606_MakeTaskTitleUnlimited'
)
BEGIN
    DECLARE @var1 sysname;
    SELECT @var1 = [d].[name]
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Tasks]') AND [c].[name] = N'Title');
    IF @var1 IS NOT NULL EXEC(N'ALTER TABLE [Tasks] DROP CONSTRAINT [' + @var1 + '];');
    ALTER TABLE [Tasks] ALTER COLUMN [Title] nvarchar(max) NOT NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260421214606_MakeTaskTitleUnlimited'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260421214606_MakeTaskTitleUnlimited', N'9.0.7');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260421214629_MakeTaskTitleUnlimiteds'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260421214629_MakeTaskTitleUnlimiteds', N'9.0.7');
END;

COMMIT;
GO

