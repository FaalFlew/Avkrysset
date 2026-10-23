using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimePlanner.API.Migrations
{
    /// <inheritdoc />
    public partial class AddRefreshTokenGracePeriod : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PreviousRefreshToken",
                table: "AspNetUsers",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PreviousRefreshTokenValidUntilUtc",
                table: "AspNetUsers",
                type: "datetime2",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PreviousRefreshToken",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "PreviousRefreshTokenValidUntilUtc",
                table: "AspNetUsers");
        }
    }
}
