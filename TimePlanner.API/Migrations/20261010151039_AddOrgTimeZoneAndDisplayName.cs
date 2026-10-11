using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimePlanner.API.Migrations
{
    /// <inheritdoc />
    public partial class AddOrgTimeZoneAndDisplayName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Tasks_OrganizationId",
                table: "Tasks");

            migrationBuilder.DropIndex(
                name: "IX_Tasks_UserId",
                table: "Tasks");

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "Organizations",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "UTC");

            migrationBuilder.AddColumn<string>(
                name: "DisplayName",
                table: "AspNetUsers",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_OrganizationId_Start",
                table: "Tasks",
                columns: new[] { "OrganizationId", "Start" });

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_UserId_Start",
                table: "Tasks",
                columns: new[] { "UserId", "Start" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Tasks_OrganizationId_Start",
                table: "Tasks");

            migrationBuilder.DropIndex(
                name: "IX_Tasks_UserId_Start",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "Organizations");

            migrationBuilder.DropColumn(
                name: "DisplayName",
                table: "AspNetUsers");

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_OrganizationId",
                table: "Tasks",
                column: "OrganizationId");

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_UserId",
                table: "Tasks",
                column: "UserId");
        }
    }
}
