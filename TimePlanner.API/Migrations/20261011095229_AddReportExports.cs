using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimePlanner.API.Migrations
{
    /// <inheritdoc />
    public partial class AddReportExports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReportExports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DocumentId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Format = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    SubjectUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    RangeStartUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RangeEndUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ViewType = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    TimeZoneId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Culture = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Paper = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: true),
                    ContentSha256 = table.Column<byte[]>(type: "binary(32)", nullable: false),
                    CreatedOnUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReportExports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReportExports_AspNetUsers_RequestedByUserId",
                        column: x => x.RequestedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ReportExports_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReportExports_DocumentId",
                table: "ReportExports",
                column: "DocumentId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReportExports_OrganizationId_CreatedOnUtc",
                table: "ReportExports",
                columns: new[] { "OrganizationId", "CreatedOnUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ReportExports_RequestedByUserId",
                table: "ReportExports",
                column: "RequestedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReportExports");
        }
    }
}
