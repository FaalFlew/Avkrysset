using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace TimePlanner.API.Utilities;

public static class DbErrors
{
    /// <summary>
    /// A unique index or constraint rejected the save (SQL Server 2601/2627), e.g. two requests creating the same
    /// thing at once after both passed the "already exists?" check. Handlers turn it into a 409.
    /// </summary>
    public static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 };
}
