using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using TimePlanner.API.DTOs;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Services;

namespace TimePlanner.API.Tests.Integration;

/// <summary>Stands in for the SignalR notifier and records every event per organization.</summary>
public sealed class RecordingNotificationService : IOrganizationNotificationService
{
    private readonly ConcurrentQueue<(Guid OrganizationId, string Event)> _events = new();

    public string[] EventsFor(Guid organizationId) =>
        _events.Where(e => e.OrganizationId == organizationId).Select(e => e.Event).ToArray();

    private Task Record(Guid organizationId, string name)
    {
        _events.Enqueue((organizationId, name));
        return Task.CompletedTask;
    }

    public Task TaskCreated(Guid organizationId, TaskItemDto task) => Record(organizationId, nameof(TaskCreated));
    public Task TaskUpdated(Guid organizationId, TaskItemDto task) => Record(organizationId, nameof(TaskUpdated));
    public Task TaskDeleted(Guid organizationId, Guid taskId) => Record(organizationId, nameof(TaskDeleted));
    public Task IssueCreated(Guid organizationId, IssueDto issue) => Record(organizationId, nameof(IssueCreated));
    public Task IssueUpdated(Guid organizationId, IssueDto issue) => Record(organizationId, nameof(IssueUpdated));
    public Task IssueDeleted(Guid organizationId, Guid panelId, Guid issueId) => Record(organizationId, nameof(IssueDeleted));
    public Task OrganizationUpdated(Guid organizationId, OrganizationDto organization) => Record(organizationId, nameof(OrganizationUpdated));
    public Task MemberRemoved(Guid organizationId, Guid removedUserId) => Record(organizationId, nameof(MemberRemoved));
    public Task MemberRoleUpdated(Guid organizationId, Guid memberUserId, string newRole) => Record(organizationId, nameof(MemberRoleUpdated));
    public Task PanelCreated(Guid organizationId, IssuePanelDto panel) => Record(organizationId, nameof(PanelCreated));
    public Task PanelUpdated(Guid organizationId, IssuePanelDto panel) => Record(organizationId, nameof(PanelUpdated));
    public Task PanelDeleted(Guid organizationId, Guid panelId) => Record(organizationId, nameof(PanelDeleted));
    public Task IssueMoved(Guid organizationId, Guid issueId, Guid newPanelId) => Record(organizationId, nameof(IssueMoved));
    public Task MemberJoined(Guid organizationId, OrganizationMembershipDto membership) => Record(organizationId, nameof(MemberJoined));
    public Task MemberLeft(Guid organizationId, Guid leftUserId) => Record(organizationId, nameof(MemberLeft));
    public Task OwnershipTransferred(Guid organizationId, Guid newOwnerId, Guid oldOwnerId) => Record(organizationId, nameof(OwnershipTransferred));
    public Task MemberSettingsUpdated(Guid organizationId, OrganizationMembershipDto membership) => Record(organizationId, nameof(MemberSettingsUpdated));
}

/// <summary>Stands in for the Postmark email service: nothing is sent, every message is recorded.</summary>
public sealed class RecordingEmailService : IEmailService
{
    private readonly ConcurrentQueue<SentEmail> _sent = new();

    public SentEmail[] SentTo(string email) =>
        _sent.Where(e => string.Equals(e.To, email, StringComparison.OrdinalIgnoreCase)).ToArray();

    public Task<bool> SendEmailAsync(string toEmail, string subject, string htmlContent)
    {
        _sent.Enqueue(new SentEmail(toEmail, subject, htmlContent));
        return Task.FromResult(true);
    }
}

public sealed record SentEmail(string To, string Subject, string HtmlBody);

/// <summary>
/// Counts the SQL commands the API sends while a counting window is open (tests in the collection
/// run one at a time, so only the request under test is counted).
/// </summary>
public sealed class SqlCommandCounter : DbCommandInterceptor
{
    private int _count;
    private volatile bool _counting;

    public int Count => _count;

    public IDisposable Start()
    {
        Interlocked.Exchange(ref _count, 0);
        _counting = true;
        return new Stopper(this);
    }

    private void Hit()
    {
        if (_counting)
        {
            Interlocked.Increment(ref _count);
        }
    }

    public override InterceptionResult<System.Data.Common.DbDataReader> ReaderExecuting(
        System.Data.Common.DbCommand command, CommandEventData eventData, InterceptionResult<System.Data.Common.DbDataReader> result)
    {
        Hit();
        return result;
    }

    public override ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
        System.Data.Common.DbCommand command, CommandEventData eventData, InterceptionResult<System.Data.Common.DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Hit();
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<int> NonQueryExecuting(
        System.Data.Common.DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        Hit();
        return result;
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        System.Data.Common.DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Hit();
        return ValueTask.FromResult(result);
    }

    public override InterceptionResult<object> ScalarExecuting(
        System.Data.Common.DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
    {
        Hit();
        return result;
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        System.Data.Common.DbCommand command, CommandEventData eventData, InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        Hit();
        return ValueTask.FromResult(result);
    }

    private sealed class Stopper(SqlCommandCounter owner) : IDisposable
    {
        public void Dispose() => owner._counting = false;
    }
}

/// <summary>
/// Makes a SaveChanges call inside the API throw, so tests can fail a transaction half-way
/// (after an earlier SaveChanges in the same transaction already wrote rows) or simulate a
/// transient error that the retrying execution strategy must recover from.
/// Arm it with a predicate that matches only the test's own data, and dispose the returned handle.
/// </summary>
public sealed class FaultInjectionInterceptor : SaveChangesInterceptor
{
    private readonly object _gate = new();
    private Func<DbContext, bool>? _when;
    private Func<Exception>? _exception;
    private int _remaining;

    public int Triggered { get; private set; }

    public IDisposable Arm(Func<DbContext, bool> when, Func<Exception> exception, int times = int.MaxValue)
    {
        lock (_gate)
        {
            _when = when;
            _exception = exception;
            _remaining = times;
            Triggered = 0;
        }

        return new Disarmer(this);
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        ThrowIfArmed(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        ThrowIfArmed(eventData.Context);
        return ValueTask.FromResult(result);
    }

    private void ThrowIfArmed(DbContext? context)
    {
        Exception? toThrow = null;
        lock (_gate)
        {
            if (context is not null && _when is not null && _remaining > 0 && _when(context))
            {
                _remaining--;
                Triggered++;
                toThrow = _exception!();
            }
        }

        if (toThrow is not null)
        {
            throw toThrow;
        }
    }

    private sealed class Disarmer(FaultInjectionInterceptor owner) : IDisposable
    {
        public void Dispose()
        {
            lock (owner._gate)
            {
                owner._when = null;
                owner._exception = null;
                owner._remaining = 0;
            }
        }
    }
}

/// <summary>
/// The API's TimeProvider in the tests: the real clock plus an offset that a test can shift for a moment
/// (e.g. "30 seconds later") and that is reset when the returned handle is disposed.
/// </summary>
public sealed class TestClock : TimeProvider
{
    private long _offsetTicks;

    public TimeSpan Offset => TimeSpan.FromTicks(Interlocked.Read(ref _offsetTicks));

    public override DateTimeOffset GetUtcNow() => base.GetUtcNow() + Offset;

    public IDisposable Shift(TimeSpan offset)
    {
        Interlocked.Exchange(ref _offsetTicks, offset.Ticks);
        return new Resetter(this);
    }

    private sealed class Resetter(TestClock owner) : IDisposable
    {
        public void Dispose() => Interlocked.Exchange(ref owner._offsetTicks, 0);
    }
}
