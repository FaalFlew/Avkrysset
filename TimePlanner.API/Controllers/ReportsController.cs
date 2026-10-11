using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.Features.Reports;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Controllers;

/// <summary>
/// Analytics exports rendered on the server (PDF via QuestPDF, CSV).
/// Query: view=monthly|weekly|daily, year, from, to (monthly: calendar year + month indexes 0-11; weekly: ISO week-year +
/// ISO weeks; daily: ISO week-year + from == to = the week), optional paper=A4|Letter (default from the locale's region),
/// optional locale=BCP-47 (dates and numbers; CSV delimiter). The X-Time-Zone header (IANA; missing or unknown = UTC)
/// decides how the selection is resolved and bucketed.
/// 200: the file, with Content-Disposition (attachment, filename + filename*), Cache-Control: no-store, X-Document-Id.
/// Errors: { message, errors } with 400 (invalid selection), 401, 429 (+ Retry-After seconds).
/// </summary>
[ApiController]
[Route("api/reports")]
[Authorize]
[ReportRendering]
public class ReportsController : ControllerBase
{
    public const string DocumentIdHeader = "X-Document-Id";

    private readonly ISender _mediator;

    public ReportsController(ISender mediator)
    {
        _mediator = mediator;
    }

    [HttpGet("personal.pdf")]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public Task<IActionResult> GetPersonalPdf(
        [FromQuery] string? view, [FromQuery] int? year, [FromQuery] int? from, [FromQuery] int? to,
        [FromQuery] string? paper, [FromQuery] string? locale, CancellationToken cancellationToken) =>
        Personal(ReportFormat.Pdf, view, year, from, to, paper, locale, cancellationToken);

    [HttpGet("personal.csv")]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK, "text/csv")]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public Task<IActionResult> GetPersonalCsv(
        [FromQuery] string? view, [FromQuery] int? year, [FromQuery] int? from, [FromQuery] int? to,
        [FromQuery] string? paper, [FromQuery] string? locale, CancellationToken cancellationToken) =>
        Personal(ReportFormat.Csv, view, year, from, to, paper, locale, cancellationToken);

    private async Task<IActionResult> Personal(
        ReportFormat format, string? view, int? year, int? from, int? to, string? paper, string? locale,
        CancellationToken cancellationToken)
    {
        var file = await _mediator.Send(
            new GetPersonalReportQuery(format, view, year, from, to, paper, locale, ClientTimeZone.GetId(Request)),
            cancellationToken);

        return ReportResult(file);
    }

    private FileContentResult ReportResult(ReportFile file)
    {
        Response.Headers.ContentDisposition = ReportFileNames.ContentDisposition(file.FileName);
        Response.Headers.CacheControl = "no-store";
        Response.Headers[DocumentIdHeader] = file.DocumentId;
        Response.Headers.XContentTypeOptions = "nosniff";
        return File(file.Content, file.ContentType);
    }
}
