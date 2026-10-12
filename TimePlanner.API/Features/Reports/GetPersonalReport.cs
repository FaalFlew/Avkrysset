using System.Security.Cryptography;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Reports;

/// <summary>A rendered export ready to send.</summary>
public sealed record ReportFile(byte[] Content, string ContentType, string FileName, string DocumentId);

/// <summary>
/// The signed-in user's analytics (personal tasks + organization tasks assigned to them) as PDF or CSV.
/// The selection is resolved in <paramref name="TimeZoneId"/> (the X-Time-Zone header; null or unknown = UTC).
/// </summary>
public record GetPersonalReportQuery(
    ReportFormat Format,
    string? View,
    int? Year,
    int? From,
    int? To,
    string? Paper,
    string? Locale,
    string? TimeZoneId) : IRequest<ReportFile>;

public class GetPersonalReportQueryValidator : AbstractValidator<GetPersonalReportQuery>
{
    public GetPersonalReportQueryValidator()
    {
        // One rule for the whole selection, so every problem is listed and range checks only run on complete input.
        RuleFor(q => q)
            .Custom((query, context) =>
            {
                ReportSelection.TryCreate(query.View, query.Year, query.From, query.To, out var errors);
                foreach (var error in errors)
                {
                    context.AddFailure(error);
                }
            });

        RuleFor(q => q.Paper)
            .Must(paper => ReportLocale.TryParsePaper(paper, out _))
            .WithMessage("paper must be 'A4' or 'Letter'.");
    }
}

public class GetPersonalReportQueryHandler : IRequestHandler<GetPersonalReportQuery, ReportFile>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ReportModelBuilder _builder;
    private readonly IReportRenderer _renderer;
    private readonly ILogger<GetPersonalReportQueryHandler> _logger;

    public GetPersonalReportQueryHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        ReportModelBuilder builder,
        IReportRenderer renderer,
        ILogger<GetPersonalReportQueryHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _builder = builder;
        _renderer = renderer;
        _logger = logger;
    }

    public async Task<ReportFile> Handle(GetPersonalReportQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var user = await _context.Users
                       .AsNoTracking()
                       .Where(u => u.Id == userId)
                       .Select(u => new { u.Email, u.DisplayName })
                       .SingleOrDefaultAsync(cancellationToken)
                   ?? throw new UnauthorizedAccessException(); // the token's user no longer exists

        // The validator has already checked these; TryCreate/TryParsePaper cannot fail here.
        var selection = ReportSelection.TryCreate(request.View, request.Year, request.From, request.To, out var errors)
                        ?? throw new BadRequestException(string.Join(" ", errors), errors);
        ReportLocale.TryParsePaper(request.Paper, out var paper);

        var generatedAtUtc = DateTime.UtcNow;
        var model = await _builder.BuildPersonalAsync(userId.Value, new ReportRequest
        {
            Kind = ReportKind.Personal,
            Selection = selection,
            TimeZoneId = request.TimeZoneId,
            Locale = request.Locale,
            Paper = paper,
            SubjectName = string.IsNullOrWhiteSpace(user.DisplayName) ? user.Email ?? "" : user.DisplayName,
            GeneratedAtUtc = generatedAtUtc,
            DocumentId = DocumentIds.New(generatedAtUtc)
        }, cancellationToken);

        var content = request.Format == ReportFormat.Pdf ? _renderer.RenderPdf(model) : CsvReportWriter.Write(model);

        _context.ReportExports.Add(new ReportExport
        {
            DocumentId = model.DocumentId,
            Kind = model.Kind.ToString(),
            Format = request.Format == ReportFormat.Pdf ? "pdf" : "csv",
            RequestedByUserId = userId.Value,
            SubjectUserId = userId.Value,
            RangeStartUtc = model.RangeStartUtc,
            RangeEndUtc = model.RangeEndUtc,
            ViewType = selection.View,
            TimeZoneId = model.TimeZoneId,
            Culture = model.CultureName,
            Paper = request.Format == ReportFormat.Pdf ? model.Paper.ToString() : null,
            ContentSha256 = SHA256.HashData(content),
            CreatedOnUtc = generatedAtUtc
        });
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Report {DocumentId} ({Format}, {View} {Year} {From}-{To}, {TimeZoneId}, {Culture}) generated: {Bytes} bytes.",
            model.DocumentId, request.Format, selection.View, selection.Year, selection.From, selection.To,
            model.TimeZoneId, model.CultureName, content.Length);

        return new ReportFile(
            content,
            request.Format == ReportFormat.Pdf ? "application/pdf" : CsvReportWriter.ContentType,
            ReportFileNames.For(selection, request.Format),
            model.DocumentId);
    }
}
