using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimePlanner.API.Migrations
{
    /// <inheritdoc />
    public partial class AddStatusMessageToMembership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "StatusMessage",
                table: "OrganizationMemberships",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StatusMessage",
                table: "OrganizationMemberships");
        }
    }
}
